/**
 * web_fetch tool — renders a URL via a local headless Chromium (no Playwright),
 * extracts the main content with Readability, converts to Markdown, and saves
 * to the run's attachments folder. Agent then reads via list/read/grep_attachment.
 *
 * Per-run URL → filename map and in-flight dedup ensure N parallel agents
 * fetching the same URL share a single browser render.
 */
import { createHash } from "crypto";
import { mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

import { launchChromium, type ChromiumProcess } from "./chromium-manager";
import { sessionDirForRun } from "../lib/workspace";
import { logger } from "../lib/logger";

// ── Config ──────────────────────────────────────────────────────────

const MAX_CONCURRENT_FETCHES = 6;
const NAV_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 30_000;
const EVAL_TIMEOUT_MS = 10_000;

const PRIVATE_IP_RE = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
  /^169\.254\./, /^::1$/, /^fc/i, /^fd/i,
];

// ── Semaphore ───────────────────────────────────────────────────────

class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];
  constructor(max: number) { this.available = max; }
  async acquire(): Promise<void> {
    if (this.available > 0) { this.available--; return; }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available++;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

const semaphore = new Semaphore(MAX_CONCURRENT_FETCHES);

// ── CDP client ──────────────────────────────────────────────────────

type CdpMsg = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string }; sessionId?: string };

class CdpClient {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventHandlers: Array<(msg: CdpMsg) => void> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data as string) as CdpMsg;
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.eventHandlers) h(msg);
      }
    });
    this.ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("CDP socket closed"));
      this.pending.clear();
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitForEvent(method: string, sessionId?: string, timeoutMs = 30_000): Promise<CdpMsg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      const handler = (msg: CdpMsg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(timer);
          this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
          resolve(msg);
        }
      };
      this.eventHandlers.push(handler);
    });
  }

  close(): void { this.ws.close(); }
  get isOpen(): boolean { return this.ws.readyState === WebSocket.OPEN; }
}

// ── Browser singleton ───────────────────────────────────────────────

type Browser = { chrome: ChromiumProcess; cdp: CdpClient };
let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

function openWs(endpoint: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (e) => reject(new Error(`ws error: ${String(e)}`)), { once: true });
  });
}

async function launchBrowser(): Promise<Browser> {
  const chrome = await launchChromium();
  const ws = await openWs(chrome.wsEndpoint);
  const cdp = new CdpClient(ws);
  return { chrome, cdp };
}

async function ensureBrowser(): Promise<Browser> {
  if (browser && browser.cdp.isOpen) return browser;
  if (launching) return launching;
  launching = launchBrowser()
    .then((b) => { browser = b; return b; })
    .finally(() => { launching = null; });
  return launching;
}

export async function shutdownWebFetchBrowser(): Promise<void> {
  if (!browser) return;
  const b = browser;
  browser = null;
  try { b.cdp.close(); } catch { /* */ }
  try { b.chrome.proc.kill(); await b.chrome.proc.exited; } catch { /* */ }
  try { rmSync(b.chrome.profileDir, { recursive: true, force: true }); } catch { /* */ }
}

// ── Fetch + extract ─────────────────────────────────────────────────

function isBlockedUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === "localhost") return true;
  return PRIVATE_IP_RE.some((re) => re.test(host));
}

function validateUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  if (isBlockedUrl(url)) throw new Error(`Blocked host (private/loopback): ${url.hostname}`);
  return url;
}

async function renderPageHtml(url: string): Promise<string> {
  const b = await ensureBrowser();
  const { targetId } = await b.cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  try {
    await b.cdp.send("Page.enable", {}, sessionId);
    const loadWait = b.cdp.waitForEvent("Page.loadEventFired", sessionId, LOAD_TIMEOUT_MS);
    await b.cdp.send("Page.navigate", { url, transitionType: "typed" }, sessionId);
    // Race navigation timeout alongside load event
    await Promise.race([
      loadWait,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`navigation timeout after ${NAV_TIMEOUT_MS}ms`)), NAV_TIMEOUT_MS)),
    ]);
    const result = await b.cdp.send<{ result: { value: string } }>(
      "Runtime.evaluate",
      { expression: "document.documentElement.outerHTML", returnByValue: true, timeout: EVAL_TIMEOUT_MS },
      sessionId,
    );
    return result.result.value;
  } finally {
    await b.cdp.send("Target.closeTarget", { targetId }).catch(() => { /* tab already gone */ });
  }
}

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });

function htmlToMarkdown(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const contentHtml = article?.content ?? html;
  let markdown = turndown.turndown(contentHtml).trim();
  markdown = markdown.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "");
  markdown = markdown.replace(/^\[\]\(#[^)]+\)\n+/gm, "");
  const title = article?.title ? `# ${article.title}\n\n` : "";
  return (title + markdown).trim();
}

// ── Filename ─────────────────────────────────────────────────────────

function slugifyUrl(u: URL): string {
  const raw = (u.hostname + u.pathname + u.search).toLowerCase();
  const slug = raw.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 50);
}

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 6);
}

function filenameFor(url: URL, originalUrl: string): string {
  return `fetch-${slugifyUrl(url)}-${shortHash(originalUrl)}.md`;
}

// ── Per-run state ───────────────────────────────────────────────────

type RunState = {
  urlToFilename: Map<string, string>;
  inFlight: Map<string, Promise<string>>;
};

const runStates = new Map<number, RunState>();

function getRunState(runId: number): RunState {
  let s = runStates.get(runId);
  if (!s) { s = { urlToFilename: new Map(), inFlight: new Map() }; runStates.set(runId, s); }
  return s;
}

export function clearWebFetchRunState(runId: number): void {
  runStates.delete(runId);
}

// ── Public ──────────────────────────────────────────────────────────

function attachmentsDir(runId: number): string {
  const dir = join(sessionDirForRun(runId), "attachments");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export type FetchResult = {
  filename: string;
  path: string;
  size: number;
  cached: boolean;
  url: string;
};

async function doFetchAndSave(runId: number, rawUrl: string): Promise<string> {
  const url = validateUrl(rawUrl);
  const filename = filenameFor(url, rawUrl);
  const path = join(attachmentsDir(runId), filename);

  logger.info("web_fetch: rendering", { runId, url: rawUrl });
  const html = await renderPageHtml(url.toString());
  const markdown = htmlToMarkdown(html, url.toString());
  writeFileSync(path, markdown);
  logger.info("web_fetch: saved", { runId, filename, size: markdown.length });
  return filename;
}

export async function webFetch(runId: number, rawUrl: string): Promise<FetchResult> {
  const state = getRunState(runId);

  const existing = state.urlToFilename.get(rawUrl);
  if (existing) {
    const path = join(attachmentsDir(runId), existing);
    return { filename: existing, path, size: statSync(path).size, cached: true, url: rawUrl };
  }

  const pending = state.inFlight.get(rawUrl);
  if (pending) {
    const filename = await pending;
    const path = join(attachmentsDir(runId), filename);
    return { filename, path, size: statSync(path).size, cached: true, url: rawUrl };
  }

  const promise = semaphore.run(() => doFetchAndSave(runId, rawUrl));
  state.inFlight.set(rawUrl, promise);
  try {
    const filename = await promise;
    state.urlToFilename.set(rawUrl, filename);
    const path = join(attachmentsDir(runId), filename);
    return { filename, path, size: statSync(path).size, cached: false, url: rawUrl };
  } finally {
    state.inFlight.delete(rawUrl);
  }
}

// ── Tool response formatter ─────────────────────────────────────────

export function formatFetchResult(r: FetchResult): string {
  const hit = r.cached ? " (already fetched in this run)" : "";
  return [
    `Saved to attachments: ${r.filename} (${r.size} bytes)${hit}`,
    `Use list_attachments to see all files, read_attachment("${r.filename}", offset, limit) or grep_attachment("${r.filename}", pattern) to read.`,
  ].join("\n");
}
