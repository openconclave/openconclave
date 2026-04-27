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
import { lookup } from "dns/promises";
import { isIPv4, isIPv6 } from "net";
import { join } from "path";
import { Readability } from "@mozilla/readability";
// linkedom instead of jsdom: jsdom's XMLHttpRequest-impl does
// require.resolve("./xhr-sync-worker.js") at module init, which Bun's
// compile step inlines as an absolute build-machine path. The compiled
// binary then tries to load a nonexistent path at runtime on other
// machines (oven-sh/bun#14011). linkedom has no worker files.
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import { launchChromium, releaseProfileDir, type ChromiumProcess } from "./chromium-manager";
import { sessionDirForRun } from "../lib/workspace";
import { logger } from "../lib/logger";

// ── Config ──────────────────────────────────────────────────────────

const MAX_CONCURRENT_FETCHES = 6;
const NAV_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 30_000;
const EVAL_TIMEOUT_MS = 10_000;
const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 10_000_000; // 10 MB cap on serialized DOM to prevent OOM

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
  private closeRejectors = new Set<(e: Error) => void>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev) => {
      let msg: CdpMsg;
      try {
        msg = JSON.parse(ev.data as string) as CdpMsg;
      } catch {
        logger.warn("web_fetch: malformed CDP frame, ignoring", { data: String(ev.data).slice(0, 100) });
        return;
      }
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
      const err = new Error("CDP socket closed");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      for (const r of this.closeRejectors) r(err);
      this.closeRejectors.clear();
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
      this.closeRejectors.add(reject);
      const timer = setTimeout(() => {
        this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
        this.closeRejectors.delete(reject);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      const handler = (msg: CdpMsg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(timer);
          this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
          this.closeRejectors.delete(reject);
          resolve(msg);
        }
      };
      this.eventHandlers.push(handler);
    });
  }

  on(handler: (msg: CdpMsg) => void): () => void {
    this.eventHandlers.push(handler);
    return () => { this.eventHandlers = this.eventHandlers.filter((e) => e !== handler); };
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
  if (browser) {
    // Stale handle (crashed or socket dropped) — tear down before relaunching.
    const dead = browser;
    browser = null;
    try { dead.cdp.close(); } catch { /* ignore */ }
    try { dead.chrome.proc.kill(); await dead.chrome.proc.exited; } catch { /* ignore */ }
    try { rmSync(dead.chrome.profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    releaseProfileDir(dead.chrome.profileDir);
  }
  launching = launchBrowser()
    .then((b) => { browser = b; return b; })
    .finally(() => { launching = null; });
  return launching;
}

export async function shutdownWebFetchBrowser(): Promise<void> {
  if (!browser) return;
  const b = browser;
  browser = null;
  try { b.cdp.close(); } catch (err) { logger.warn("web_fetch: CDP close failed", { err: String(err) }); }
  try { b.chrome.proc.kill(); await b.chrome.proc.exited; } catch (err) { logger.warn("web_fetch: browser process kill failed", { err: String(err) }); }
  try { rmSync(b.chrome.profileDir, { recursive: true, force: true }); } catch (err) { logger.warn("web_fetch: profile dir removal failed", { err: String(err) }); }
  releaseProfileDir(b.chrome.profileDir);
}

// ── Fetch + extract ─────────────────────────────────────────────────

// Private/reserved IPv4 ranges as [networkInt, prefix] pairs.
// Covers RFC 1918, loopback, link-local, CGNAT, TEST-NET, multicast, reserved.
const PRIVATE_V4_RANGES: Array<[number, number]> = [
  [0x00000000, 8],  // 0.0.0.0/8
  [0x0A000000, 8],  // 10.0.0.0/8
  [0x7F000000, 8],  // 127.0.0.0/8 loopback
  [0xA9FE0000, 16], // 169.254.0.0/16 link-local
  [0xAC100000, 12], // 172.16.0.0/12
  [0xC0A80000, 16], // 192.168.0.0/16
  [0x64400000, 10], // 100.64.0.0/10 CGNAT
  [0xC0000000, 24], // 192.0.0.0/24 IETF
  [0xC0000200, 24], // 192.0.2.0/24 TEST-NET-1
  [0xC6336400, 24], // 198.51.100.0/24 TEST-NET-2
  [0xCB007100, 24], // 203.0.113.0/24 TEST-NET-3
  [0xE0000000, 4],  // 224.0.0.0/4 multicast
  [0xF0000000, 4],  // 240.0.0.0/4 reserved
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n * 256) + b;
  }
  return n >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  if (int === null) return false;
  for (const [net, prefix] of PRIVATE_V4_RANGES) {
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    if ((int & mask) === (net & mask)) return true;
  }
  return false;
}

function isPrivateV6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped in dotted-decimal form: ::ffff:a.b.c.d
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]!);
  // IPv4-mapped in all-hex form: ::ffff:xxxx:xxxx (WHATWG URL normalises to this).
  // e.g. ::ffff:7f00:1 = 127.0.0.1
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return isPrivateV4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 ULA
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // fe80::/10 link-local
  if (normalized.startsWith("ff")) return true; // multicast
  return false;
}

async function isBlockedHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  if (isIPv4(host)) return isPrivateV4(host);
  if (isIPv6(host)) return isPrivateV6(host);

  try {
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
      if (a.family === 4 && isPrivateV4(a.address)) return true;
      if (a.family === 6 && isPrivateV6(a.address)) return true;
    }
    return false;
  } catch (err) {
    // DNS failure — treat as blocked rather than leaking into the browser unvalidated.
    logger.warn("web_fetch: DNS resolution failed, blocking", { host, err: String(err) });
    return true;
  }
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

async function validateUrl(raw: string): Promise<URL> {
  if (typeof raw !== "string") throw new Error("URL must be a string");
  if (raw.length > MAX_URL_LENGTH) throw new Error(`URL exceeds max length ${MAX_URL_LENGTH}`);
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new Error(`Port not allowed: ${url.port}`);
  }
  if (await isBlockedHost(url.hostname)) {
    throw new Error(`Blocked host (private/loopback/unresolvable): ${url.hostname}`);
  }
  return url;
}

async function renderPageHtml(url: string): Promise<string> {
  const b = await ensureBrowser();
  // Fresh browser context per fetch isolates cookies / localStorage / cache
  // / service workers from other fetches in the same process.
  const { browserContextId } = await b.cdp.send<{ browserContextId: string }>(
    "Target.createBrowserContext",
    { disposeOnDetach: true },
  );
  let targetId: string | undefined;
  let offIntercept: (() => void) | undefined;
  try {
    ({ targetId } = await b.cdp.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "about:blank", browserContextId },
    ));
    const { sessionId } = await b.cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    await b.cdp.send("Page.enable", {}, sessionId);
    // Intercept every request so redirects and subsequent navigations are
    // re-validated against isBlockedHost, closing the redirect-SSRF and
    // narrowing the DNS-rebinding window.
    await b.cdp.send("Fetch.enable", { patterns: [{ requestStage: "Request" }] }, sessionId);
    offIntercept = b.cdp.on(async (msg) => {
      if (msg.method !== "Fetch.requestPaused" || msg.sessionId !== sessionId) return;
      const { requestId, request } = msg.params as { requestId: string; request: { url: string } };
      let blocked = false;
      try {
        const reqUrl = new URL(request.url);
        if ((reqUrl.protocol === "http:" || reqUrl.protocol === "https:") && await isBlockedHost(reqUrl.hostname)) {
          blocked = true;
        }
      } catch { /* unparseable URL — let Chrome handle it */ }
      if (blocked) {
        b.cdp.send("Fetch.failRequest", { requestId, errorReason: "AddressUnreachable" }, sessionId).catch(() => {});
      } else {
        b.cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
      }
    });
    const loadWait = b.cdp.waitForEvent("Page.loadEventFired", sessionId, LOAD_TIMEOUT_MS);
    await b.cdp.send("Page.navigate", { url, transitionType: "typed" }, sessionId);
    let navTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const navTimeout = new Promise<never>((_, reject) => {
      navTimeoutId = setTimeout(() => reject(new Error(`navigation timeout after ${NAV_TIMEOUT_MS}ms`)), NAV_TIMEOUT_MS);
    });
    // Suppress unhandled rejection on whichever leg of the race loses.
    navTimeout.catch(() => {});
    loadWait.catch(() => {});
    try {
      await Promise.race([loadWait, navTimeout]);
    } finally {
      clearTimeout(navTimeoutId);
    }
    const result = await b.cdp.send<{ result: { value: string } }>(
      "Runtime.evaluate",
      {
        expression: `document.documentElement.outerHTML.slice(0, ${MAX_HTML_BYTES})`,
        returnByValue: true,
        timeout: EVAL_TIMEOUT_MS,
      },
      sessionId,
    );
    return result.result.value;
  } finally {
    offIntercept?.();
    if (targetId) {
      await b.cdp.send("Target.closeTarget", { targetId }).catch((err) => {
        logger.debug("web_fetch: Target.closeTarget failed", { err: String(err) });
      });
    }
    // Explicit dispose covers the case where target was created but session never
    // attached (disposeOnDetach only fires on session disconnect).
    await b.cdp.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }
}

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });

function htmlToMarkdown(html: string, url: string): string {
  // linkedom's parseHTML has no `url` option the way jsdom does, so we inject a
  // <base href> into <head> — Readability reads document.baseURI to resolve
  // relative links, and inserting <base> is the well-trodden path when the
  // parser doesn't take a baseURL directly.
  const safeUrl = url.replace(/"/g, "&quot;");
  const withBase = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b([^>]*)>/i, `<head$1><base href="${safeUrl}">`)
    : `<head><base href="${safeUrl}"></head>${html}`;
  const { document } = parseHTML(withBase);
  // Readability's type expects jsdom's Document; linkedom's is structurally
  // compatible for Readability's usage but nominally different.
  const article = new Readability(document as unknown as Document).parse();
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
  mkdirSync(dir, { recursive: true, mode: 0o700 });
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
  const url = await validateUrl(rawUrl);
  const filename = filenameFor(url, rawUrl);
  const path = join(attachmentsDir(runId), filename);

  logger.info("web_fetch: rendering", { runId, url: rawUrl });
  const html = await renderPageHtml(url.toString());
  const markdown = htmlToMarkdown(html, url.toString());
  writeFileSync(path, markdown, { mode: 0o600 });
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
