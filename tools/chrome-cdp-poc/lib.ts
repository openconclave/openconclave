/**
 * Core fetch-to-attachments logic. HTTP server (server.ts) and CLI (index.ts)
 * both sit on top of this.
 *
 * Design:
 *   - One long-lived Chromium (module singleton, lazy launch, race-safe)
 *   - Semaphore caps concurrent fetches (default 6)
 *   - Per-run state: Map<runId, { urlToFilename, inFlight }>
 *   - Filename scheme: `fetch-<slug>-<6charSha1>.md` (deterministic, dedup-friendly)
 *   - Files saved to sessions/<runId>/attachments/<filename> (POC root)
 */
import { spawn, type Subprocess } from "bun";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

// ── Config ──────────────────────────────────────────────────────────

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ??
  "C:\\Users\\beine\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1217\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const SESSIONS_ROOT = join(import.meta.dir, "sessions");
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

type Browser = { proc: Subprocess<"ignore", "pipe", "pipe">; cdp: CdpClient; profileDir: string };
let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const profileDir = mkdtempSync(join(tmpdir(), "oc-web-fetch-"));
  const proc = spawn({
    cmd: [
      CHROMIUM_PATH,
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  const endpoint = await readWsEndpoint(proc);
  const ws = await openWs(endpoint);
  const cdp = new CdpClient(ws);
  return { proc, cdp, profileDir };
}

async function readWsEndpoint(proc: Subprocess<"ignore", "pipe", "pipe">): Promise<string> {
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("chromium exited before announcing DevTools endpoint");
    buf += decoder.decode(value, { stream: true });
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { reader.releaseLock(); return m[1]!; }
  }
}

function openWs(endpoint: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (e) => reject(new Error(`ws error: ${String(e)}`)), { once: true });
  });
}

async function ensureBrowser(): Promise<Browser> {
  if (browser && browser.cdp.isOpen) return browser;
  if (launching) return launching;
  launching = launchBrowser().then((b) => { browser = b; return b; }).finally(() => { launching = null; });
  return launching;
}

export async function shutdownBrowser(): Promise<void> {
  if (!browser) return;
  const b = browser;
  browser = null;
  try { b.cdp.close(); } catch { /* */ }
  try { b.proc.kill(); await b.proc.exited; } catch { /* */ }
  try { rmSync(b.profileDir, { recursive: true, force: true }); } catch { /* */ }
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
    await b.cdp.send("Page.navigate", { url }, sessionId);
    await loadWait;
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
  // Strip base64 data-URL images (always bloat, never useful)
  markdown = markdown.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "");
  // Strip GitHub-style empty anchor placeholders
  markdown = markdown.replace(/^\[\]\(#[^)]+\)\n+/gm, "");
  const title = article?.title ? `# ${article.title}\n\n` : "";
  return (title + markdown).trim();
}

// ── Filename scheme ─────────────────────────────────────────────────

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

const runStates = new Map<string, RunState>();

function getRunState(runId: string): RunState {
  let s = runStates.get(runId);
  if (!s) { s = { urlToFilename: new Map(), inFlight: new Map() }; runStates.set(runId, s); }
  return s;
}

export function clearRunState(runId: string): void {
  runStates.delete(runId);
}

// ── Public API ──────────────────────────────────────────────────────

export type FetchResult = {
  filename: string;
  path: string;
  size: number;
  cached: boolean;
  url: string;
};

function attachmentsDir(runId: string): string {
  const dir = join(SESSIONS_ROOT, runId, "attachments");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function doFetchAndSave(runId: string, rawUrl: string): Promise<string> {
  const url = validateUrl(rawUrl);
  const filename = filenameFor(url, rawUrl);
  const path = join(attachmentsDir(runId), filename);

  const html = await renderPageHtml(url.toString());
  const markdown = htmlToMarkdown(html, url.toString());
  writeFileSync(path, markdown);
  return filename;
}

export async function webFetch(runId: string, rawUrl: string): Promise<FetchResult> {
  const state = getRunState(runId);

  // Completed cache hit for this run
  const existing = state.urlToFilename.get(rawUrl);
  if (existing) {
    const path = join(attachmentsDir(runId), existing);
    const size = statSync(path).size;
    return { filename: existing, path, size, cached: true, url: rawUrl };
  }

  // In-flight dedup — second caller within the run awaits the first's fetch
  const pending = state.inFlight.get(rawUrl);
  if (pending) {
    const filename = await pending;
    const path = join(attachmentsDir(runId), filename);
    const size = statSync(path).size;
    return { filename, path, size, cached: true, url: rawUrl };
  }

  const promise = semaphore.run(() => doFetchAndSave(runId, rawUrl));
  state.inFlight.set(rawUrl, promise);
  try {
    const filename = await promise;
    state.urlToFilename.set(rawUrl, filename);
    const path = join(attachmentsDir(runId), filename);
    const size = statSync(path).size;
    return { filename, path, size, cached: false, url: rawUrl };
  } finally {
    state.inFlight.delete(rawUrl);
  }
}

export function readSavedMarkdown(runId: string, filename: string): string {
  const path = join(attachmentsDir(runId), filename);
  return readFileSync(path, "utf-8");
}

export function getRunSnapshot(runId: string): { urls: Array<{ url: string; filename: string }>; inFlight: string[] } {
  const s = runStates.get(runId);
  if (!s) return { urls: [], inFlight: [] };
  return {
    urls: [...s.urlToFilename.entries()].map(([url, filename]) => ({ url, filename })),
    inFlight: [...s.inFlight.keys()],
  };
}
