#!/usr/bin/env bun
/**
 * Standalone HTTP server exposing the web_fetch primitive.
 * Lets us curl it and verify per-run dedup, in-flight dedup, concurrency,
 * filename scheme, and saved-file correctness before porting into OC core.
 *
 * Endpoints:
 *   POST /fetch                      { runId, url }            → FetchResult JSON
 *   GET  /fetch?runId=X&url=Y                                  → FetchResult JSON
 *   GET  /runs/:runId/state                                    → { urls, inFlight }
 *   GET  /runs/:runId/attachments/:filename                    → raw markdown
 *   DELETE /runs/:runId                                        → clears run state
 *   GET  /health                                               → { ok, uptime }
 */
import { clearRunState, getRunSnapshot, readSavedMarkdown, shutdownBrowser, webFetch } from "./lib";

const PORT = Number(process.env.PORT ?? 4100);
const startedAt = Date.now();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: { message } }, status);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    // --- Health ----------------------------------------------------
    if (method === "GET" && url.pathname === "/health") {
      return json({ ok: true, uptimeMs: Date.now() - startedAt });
    }

    // --- Fetch (GET or POST) --------------------------------------
    if (url.pathname === "/fetch") {
      let runId: string | undefined;
      let target: string | undefined;
      if (method === "GET") {
        runId = url.searchParams.get("runId") ?? undefined;
        target = url.searchParams.get("url") ?? undefined;
      } else if (method === "POST") {
        try {
          const body = await req.json() as { runId?: string; url?: string };
          runId = body.runId;
          target = body.url;
        } catch {
          return err("invalid JSON body", 400);
        }
      } else {
        return err("use GET or POST", 405);
      }
      if (!runId) return err("runId required", 400);
      if (!target) return err("url required", 400);
      try {
        const result = await webFetch(runId, target);
        return json(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg, 500);
      }
    }

    // --- Run state -------------------------------------------------
    const stateMatch = url.pathname.match(/^\/runs\/([^/]+)\/state$/);
    if (method === "GET" && stateMatch) {
      const runId = stateMatch[1]!;
      return json(getRunSnapshot(runId));
    }

    // --- Read saved markdown --------------------------------------
    const fileMatch = url.pathname.match(/^\/runs\/([^/]+)\/attachments\/([^/]+)$/);
    if (method === "GET" && fileMatch) {
      const runId = fileMatch[1]!;
      const filename = fileMatch[2]!;
      try {
        const text = readSavedMarkdown(runId, filename);
        return new Response(text, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e), 404);
      }
    }

    // --- Clear run state ------------------------------------------
    const clearMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
    if (method === "DELETE" && clearMatch) {
      const runId = clearMatch[1]!;
      clearRunState(runId);
      return json({ ok: true, runId });
    }

    return err("not found", 404);
  },
});

console.log(`web_fetch POC listening at http://localhost:${server.port}`);
console.log("try:");
console.log(`  curl -X POST http://localhost:${server.port}/fetch -H 'content-type: application/json' -d '{"runId":"test","url":"https://openconclave.com/"}'`);
console.log(`  curl http://localhost:${server.port}/runs/test/state`);
console.log(`  curl http://localhost:${server.port}/runs/test/attachments/fetch-openconclave-com-xxxxxx.md`);

process.on("SIGINT", async () => {
  console.log("\nshutting down...");
  await shutdownBrowser();
  server.stop();
  process.exit(0);
});
