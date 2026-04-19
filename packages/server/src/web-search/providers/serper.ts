import type { SearchOptions, SearchResponse, TestResult } from "../types";

interface SerperResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

export async function searchSerper(apiKey: string, query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    signal: opts.signal,
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: opts.limit ?? 10,
      hl: opts.language?.split("-")[0] ?? "en",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json() as { organic?: SerperResult[] };
  const results = (data.organic ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
    publishedDate: r.date,
  }));
  return { results };
}

export async function testSerper(apiKey: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const { results } = await searchSerper(apiKey, query, { signal, limit: 3 });
  return {
    ok: true,
    sampleTitles: results.map((r) => r.title).filter(Boolean),
    warn: results.length === 0 ? "Reachable but returned zero results" : undefined,
  };
}
