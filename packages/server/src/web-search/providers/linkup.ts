import type { TestResult } from "../test";

export async function testLinkup(apiKey: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const res = await fetch("https://api.linkup.so/v1/search", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, depth: "standard", outputType: "searchResults" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `${res.status}: ${text.slice(0, 200) || res.statusText}` };
  }
  const data = await res.json() as { results?: Array<{ name?: string; title?: string }> };
  const sampleTitles = (data.results ?? []).slice(0, 3).map((r) => r.name ?? r.title ?? "").filter(Boolean);
  return {
    ok: true,
    sampleTitles,
    warn: sampleTitles.length === 0 ? "Reachable but returned zero results" : undefined,
  };
}
