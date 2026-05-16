/**
 * Demo: query SearXNG, take top N URLs, run them through web_fetch,
 * and report what got saved. Mirrors what an agent does when it chains
 * web_search → web_fetch → read_attachment.
 *
 * Run with:
 *   bun run packages/server/src/scripts/search-fetch-demo.ts "<query>" [n]
 *
 * Honors OC_DATA_DIR; recommended:
 *   $env:OC_DATA_DIR = "$env:TEMP\oc-demo"; bun run packages/server/src/scripts/search-fetch-demo.ts "your query" 3
 */
import { webFetch, shutdownWebFetchBrowser } from "../agent/web-fetch";
import { sessionDirForRun, WORKSPACE } from "../lib/workspace";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
const DEMO_RUN_ID = 99999990;

async function searxng(query: string, limit: number) {
  const u = new URL("/search", SEARXNG_URL);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  u.searchParams.set("language", "en");
  const resp = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`SearXNG HTTP ${resp.status}`);
  const data = (await resp.json()) as { results: Array<{ title: string; url: string; content?: string; engine?: string; score?: number }> };
  return data.results.slice(0, limit);
}

async function main() {
  const query = process.argv[2] ?? "Anthropic Claude prompt caching";
  const limit = Number(process.argv[3] ?? 3);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Query: ${query}  (top ${limit})`);
  console.log(`SearXNG: ${SEARXNG_URL}\n`);

  const results = await searxng(query, limit);
  console.log("SearXNG results:");
  for (const [i, r] of results.entries()) {
    console.log(`  ${i + 1}. [${r.engine ?? "?"} score=${r.score ?? "?"}] ${r.title}\n     ${r.url}`);
  }

  console.log(`\nFetching ${results.length} URLs through web_fetch (runId=${DEMO_RUN_ID}) ...`);
  const t0 = Date.now();
  const fetched = await Promise.all(
    results.map(async (r) => {
      try {
        return { ok: true as const, r, fr: await webFetch(DEMO_RUN_ID, r.url) };
      } catch (e) {
        return { ok: false as const, r, err: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const ms = Date.now() - t0;
  console.log(`\nweb_fetch results (${ms}ms total, semaphore caps concurrency at 6):`);
  for (const f of fetched) {
    if (f.ok) console.log(`  OK   ${f.fr.size.toString().padStart(7)} B  ${f.fr.filename}  ← ${f.r.url}`);
    else console.log(`  FAIL  ${f.err}  ← ${f.r.url}`);
  }

  const dir = join(sessionDirForRun(DEMO_RUN_ID), "attachments");
  const files = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  console.log(`\nAttachments folder: ${dir}`);
  console.log(`  ${files.length} markdown files`);

  const first = fetched.find((f) => f.ok) as { ok: true; fr: { filename: string; path: string } } | undefined;
  if (first) {
    console.log(`\n--- First 40 lines of ${first.fr.filename} ---`);
    const lines = readFileSync(first.fr.path, "utf8").split("\n").slice(0, 40);
    console.log(lines.join("\n"));
  }

  await shutdownWebFetchBrowser();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
