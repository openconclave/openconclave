import type { SearchOptions, SearchResponse, TestResult } from "../types";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string | null;
}

export async function searchTavily(apiKey: string, query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal: opts.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: opts.limit ?? 10,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json() as { results?: TavilyResult[] };
  const results = (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
    publishedDate: r.published_date ?? undefined,
  }));
  return { results };
}

export async function testTavily(apiKey: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const { results } = await searchTavily(apiKey, query, { signal, limit: 3 });
  return {
    ok: true,
    sampleTitles: results.map((r) => r.title).filter(Boolean),
    warn: results.length === 0 ? "Reachable but returned zero results" : undefined,
  };
}
