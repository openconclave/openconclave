import type { SearchOptions, SearchResponse, TestResult } from "../types";

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
  engines?: string[];
  publishedDate?: string | null;
}

export async function searchSearxng(url: string, query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const base = url.replace(/\/$/, "");
  const params = new URLSearchParams({
    q: query,
    format: "json",
    language: opts.language ?? "en-US",
  });
  const res = await fetch(`${base}/search?${params}`, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}. Is JSON format enabled in settings.yml?`);
  }
  const data = await res.json() as { results?: SearxngResult[] };
  const raw = data.results ?? [];
  const limit = opts.limit ?? 10;
  const engineSet = new Set<string>();
  const results = raw.slice(0, limit).map((r) => {
    for (const e of r.engines ?? []) engineSet.add(e);
    return {
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
      engines: r.engines,
      publishedDate: r.publishedDate ?? undefined,
    };
  });
  return { results, engines: [...engineSet].sort() };
}

export async function testSearxng(url: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const { results, engines } = await searchSearxng(url, query, { signal, limit: 3 });
  return {
    ok: true,
    sampleTitles: results.map((r) => r.title).filter(Boolean),
    engines,
    warn: results.length === 0 ? "Reachable but returned zero results — check engine configuration" : undefined,
  };
}
