#!/usr/bin/env bun
/**
 * POC: talk to Chromium via CDP over WebSocket from Bun.
 * No Playwright. Just spawn + parse stderr + WS.
 *
 * Usage:
 *   bun run index.ts <url> [outFile]
 */
import { spawn } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

const CHROMIUM =
  "C:\\Users\\beine\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1217\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const url = process.argv[2] ?? "https://en.wikipedia.org/wiki/Bun_(software)";
const outFile = process.argv[3];
const profileDir = mkdtempSync(join(tmpdir(), "oc-cdp-poc-"));

const proc = spawn({
  cmd: [
    CHROMIUM,
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

// Parse "DevTools listening on ws://..." from stderr
async function readWsEndpoint(): Promise<string> {
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("chromium exited before announcing DevTools endpoint");
    buf += decoder.decode(value, { stream: true });
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) {
      reader.releaseLock();
      return m[1]!;
    }
  }
}

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
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
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

  close(): void {
    this.ws.close();
  }
}

async function openWs(endpoint: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (e) => reject(new Error(`ws error: ${String(e)}`)), { once: true });
  });
}

async function main() {
  console.log("launching chromium...");
  const t0 = Date.now();
  const endpoint = await readWsEndpoint();
  console.log(`got endpoint in ${Date.now() - t0}ms: ${endpoint}`);

  const ws = await openWs(endpoint);
  console.log("ws connected");
  const cdp = new CdpClient(ws);

  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  console.log(`targetId=${targetId}`);

  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  console.log(`sessionId=${sessionId}`);

  await cdp.send("Page.enable", {}, sessionId);

  const loadWait = cdp.waitForEvent("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loadWait;
  console.log(`page loaded in ${Date.now() - t0}ms`);

  const result = await cdp.send<{ result: { value: string } }>(
    "Runtime.evaluate",
    { expression: "document.documentElement.outerHTML", returnByValue: true },
    sessionId,
  );
  const html = result.result.value;
  console.log(`raw html: ${html.length} chars`);

  // Extract main content via Readability + Turndown
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const contentHtml = article?.content ?? html;
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  const markdown = turndown.turndown(contentHtml).trim();
  const title = article?.title ? `# ${article.title}\n\n` : "";
  const output = title + markdown;
  console.log(`markdown: ${output.length} chars`);

  if (outFile) {
    writeFileSync(outFile, output);
    console.log(`saved to ${outFile}`);
  } else {
    console.log("--- first 800 chars ---");
    console.log(output.slice(0, 800));
    console.log("--- end ---");
  }

  await cdp.send("Target.closeTarget", { targetId });
  cdp.close();
  proc.kill();
  await proc.exited;
  try { rmSync(profileDir, { recursive: true, force: true }); }
  catch { /* profile dir may still be locked on Windows briefly; best-effort */ }
  console.log(`total: ${Date.now() - t0}ms`);
}

main().catch(async (err) => {
  console.error("FAIL:", err);
  proc.kill();
  try { await proc.exited; } catch { /* */ }
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* */ }
  process.exit(1);
});
