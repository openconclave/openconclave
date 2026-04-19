import type { TestResult } from "../test";

export async function testSearxng(url: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const base = url.replace(/\/$/, "");
  const search = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en-US`;
  const res = await fetch(search, { signal });
  if (!res.ok) {
    return { ok: false, error: `${res.status} ${res.statusText}. Is JSON format enabled in settings.yml?` };
  }
  const data = await res.json() as { results?: Array<{ title?: string; engines?: string[] }> };
  const results = data.results ?? [];
  const sampleTitles = results.slice(0, 3).map((r) => r.title ?? "").filter(Boolean);
  const engineSet = new Set<string>();
  for (const r of results) for (const e of r.engines ?? []) engineSet.add(e);
  return {
    ok: true,
    sampleTitles,
    engines: [...engineSet].sort(),
    warn: results.length === 0 ? "Reachable but returned zero results — check engine configuration" : undefined,
  };
}
