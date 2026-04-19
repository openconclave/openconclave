import type { TestResult } from "../test";

export async function testSerper(apiKey: string, query: string, signal: AbortSignal): Promise<TestResult> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    signal,
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 3 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `${res.status}: ${text.slice(0, 200) || res.statusText}` };
  }
  const data = await res.json() as { organic?: Array<{ title?: string }> };
  const sampleTitles = (data.organic ?? []).slice(0, 3).map((r) => r.title ?? "").filter(Boolean);
  return {
    ok: true,
    sampleTitles,
    warn: sampleTitles.length === 0 ? "Reachable but returned zero results" : undefined,
  };
}
