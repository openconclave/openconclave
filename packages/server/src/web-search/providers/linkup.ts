import type { SearchOptions, SearchResponse, TestResult } from "../types";

interface LinkupResult {
  name?: string;
  title?: string;
  url?: string;
  snippet?: string;
  content?: string;
}

export async function searchLinkup(apiKey: string, query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const res = await fetch("https://api.linkup.so/v1/search", {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      depth: "standard",
      outputType: "searchResults",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json() as { results?: LinkupResult[] };
  const limit = opts.limit ?? 10;
  const results = (data.results ?? []).slice(0, limit).map((r) => ({
    title: r.name ?? r.title ?? "",
    url: r.url ?? "",
    snippet: r.snippet ?? r.content ?? "",
  }));
  return { results };
}

export async function testLinkup(apiKey: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const { results } = await searchLinkup(apiKey, query, { signal, limit: 3 });
  return {
    ok: true,
    sampleTitles: results.map((r) => r.title).filter(Boolean),
    warn: results.length === 0 ? "Reachable but returned zero results" : undefined,
  };
}
