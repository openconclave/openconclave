/**
 * oc-websearch — query OC's local SearXNG, fetch top-N URLs through OC's
 * web_fetch (headless Chromium + Readability + Turndown), and save the
 * extracted markdown to a chosen folder along with an index.md.
 *
 * Usage:
 *   bun run scripts/oc-websearch.ts "<query>" [--limit N] [--out <dir>]
 *
 * Defaults:
 *   --limit 5
 *   --out   .research/<query-slug>-<yyyymmdd-hhmmss>/
 *
 * Env:
 *   SEARXNG_URL  default http://localhost:8080
 *   OC_DATA_DIR  where web_fetch parks its per-run attachments cache
 *                (defaults to ${TEMP}\oc-websearch if unset)
 */
import { mkdirSync, copyFileSync, writeFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { webFetch, shutdownWebFetchBrowser } from "../packages/server/src/agent/web-fetch";
import { sessionDirForRun } from "../packages/server/src/lib/workspace";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";

type Args = { query: string; limit: number; out: string; runId?: number };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.error('Usage: bun run scripts/oc-websearch.ts "<query>" [--limit N] [--out <dir>] [--run-id N]');
    process.exit(1);
  }
  const query = argv[0]!;
  let limit = 5;
  let out: string | undefined;
  let runId: number | undefined;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") limit = Number(argv[++i] ?? 5);
    else if (a === "--out") out = argv[++i];
    else if (a === "--run-id") runId = Number(argv[++i] ?? "");
  }
  // When run-id is given, webFetch already writes to sessions/<runId>/attachments/.
  // Use that as the canonical output dir and skip the copy.
  if (runId != null && Number.isFinite(runId)) {
    out = join(sessionDirForRun(runId), "attachments");
  } else if (!out) {
    const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    out = join(".research", `${slug}-${ts}`);
  }
  return { query, limit: Math.max(1, Math.min(20, limit)), out: resolve(out), runId };
}

type SearchHit = {
  title: string;
  url: string;
  content?: string;
  engine?: string;
  engines?: string[];
  score?: number;
  publishedDate?: string;
};

async function searxng(query: string, limit: number): Promise<SearchHit[]> {
  const u = new URL("/search", SEARXNG_URL);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  u.searchParams.set("language", "en");
  const resp = await fetch(u, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`SearXNG HTTP ${resp.status}`);
  const data = (await resp.json()) as { results: SearchHit[] };
  return data.results.slice(0, limit);
}

function renderIndex(query: string, hits: SearchHit[], saved: Array<{ hit: SearchHit; file?: string; size?: number; error?: string }>): string {
  const lines: string[] = [];
  lines.push(`# oc-websearch: ${query}`);
  lines.push("");
  lines.push(`- Provider: SearXNG @ ${SEARXNG_URL}`);
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Results: ${hits.length}`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  for (const [i, s] of saved.entries()) {
    const tag = s.error
      ? `**FAIL** — ${s.error}`
      : `[${s.file}](./${s.file}) (${s.size} B)`;
    const meta: string[] = [];
    if (s.hit.engines?.length) meta.push(`engines: ${s.hit.engines.join("+")}`);
    if (typeof s.hit.score === "number") meta.push(`score: ${s.hit.score.toFixed(2)}`);
    if (s.hit.publishedDate) meta.push(`date: ${s.hit.publishedDate}`);
    lines.push(`### ${i + 1}. ${s.hit.title || "(untitled)"}`);
    lines.push("");
    lines.push(`- URL: ${s.hit.url}`);
    if (meta.length) lines.push(`- ${meta.join(" · ")}`);
    lines.push(`- File: ${tag}`);
    if (s.hit.content) {
      lines.push(`- Snippet: ${s.hit.content.trim().replace(/\s+/g, " ").slice(0, 280)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const { query, limit, out, runId } = parseArgs();
  if (!process.env.OC_DATA_DIR) {
    process.env.OC_DATA_DIR = join(tmpdir(), "oc-websearch");
  }
  mkdirSync(out, { recursive: true });

  console.log(`Query : ${query}`);
  console.log(`Limit : ${limit}`);
  console.log(`Out   : ${out}`);
  console.log(`SearXNG: ${SEARXNG_URL}`);
  console.log("");

  const hits = await searxng(query, limit);
  if (hits.length === 0) {
    console.log("No results.");
    writeFileSync(join(out, "index.md"), `# oc-websearch: ${query}\n\nNo results.\n`);
    return;
  }

  console.log("Results:");
  for (const [i, h] of hits.entries()) {
    console.log(`  ${i + 1}. [${h.engine ?? "?"} score=${(h.score ?? 0).toFixed(2)}] ${h.title}`);
    console.log(`     ${h.url}`);
  }
  console.log("");

  const effectiveRunId = runId ?? (990_000_000 + Math.floor(Math.random() * 999_999));
  console.log(`Fetching ${hits.length} URLs (runId=${effectiveRunId}${runId != null ? " — real" : " — synthetic"}, max 6 concurrent) ...`);
  const t0 = Date.now();
  const fetched = await Promise.all(
    hits.map(async (hit) => {
      try {
        const fr = await webFetch(effectiveRunId, hit.url);
        return { hit, fr };
      } catch (e) {
        return { hit, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const ms = Date.now() - t0;

  const saved: Array<{ hit: SearchHit; file?: string; size?: number; error?: string }> = [];
  for (const f of fetched) {
    if ("error" in f) {
      saved.push({ hit: f.hit, error: f.error });
      continue;
    }
    // When runId is real, webFetch already wrote to `out` (sessions/<runId>/attachments/);
    // skip the copy. Otherwise we landed in a synthetic-runId folder and need to copy.
    if (runId == null) {
      const dest = join(out, f.fr.filename);
      copyFileSync(f.fr.path, dest);
      saved.push({ hit: f.hit, file: f.fr.filename, size: statSync(dest).size });
    } else {
      saved.push({ hit: f.hit, file: f.fr.filename, size: f.fr.size });
    }
  }

  console.log(`\nFetched in ${ms} ms:`);
  for (const s of saved) {
    if (s.error) console.log(`  FAIL  ${s.hit.url} — ${s.error}`);
    else console.log(`  OK   ${String(s.size).padStart(7)} B  ${s.file}`);
  }

  const indexPath = join(out, "index.md");
  writeFileSync(indexPath, renderIndex(query, hits, saved), "utf8");
  console.log(`\nWrote ${indexPath}`);

  await shutdownWebFetchBrowser();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
