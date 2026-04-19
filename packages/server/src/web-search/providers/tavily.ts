import type { TestResult } from "../test";

export async function testTavily(apiKey: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 3 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `${res.status}: ${text.slice(0, 200) || res.statusText}` };
  }
  const data = await res.json() as { results?: Array<{ title?: string }> };
  const sampleTitles = (data.results ?? []).slice(0, 3).map((r) => r.title ?? "").filter(Boolean);
  return {
    ok: true,
    sampleTitles,
    warn: sampleTitles.length === 0 ? "Reachable but returned zero results" : undefined,
  };
}
