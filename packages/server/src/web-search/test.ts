import { testSearxng } from "./providers/searxng";
import { testTavily } from "./providers/tavily";
import { testSerper } from "./providers/serper";
import { testLinkup } from "./providers/linkup";
import type { TestResult, WebSearchProviderId } from "./types";

export type { TestResult, WebSearchProviderId } from "./types";

const CANARY_QUERY = "openconclave test query";
const TIMEOUT_MS = 8000;

export async function testWebSearch(
  provider: Exclude<WebSearchProviderId, "none">,
  credential: string,
): Promise<TestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const result = await dispatch(provider, credential, controller.signal);
    return { ...result, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : "Test failed";
    return { ok: false, latencyMs, error: controller.signal.aborted ? "Timeout after 8s" : message };
  } finally {
    clearTimeout(timeout);
  }
}

function dispatch(
  provider: Exclude<WebSearchProviderId, "none">,
  credential: string,
  signal: AbortSignal,
): Promise<TestResult> {
  if (provider === "searxng") return testSearxng(credential, CANARY_QUERY, signal);
  if (provider === "tavily") return testTavily(credential, CANARY_QUERY, signal);
  if (provider === "serper") return testSerper(credential, CANARY_QUERY, signal);
  if (provider === "linkup") return testLinkup(credential, CANARY_QUERY, signal);
  return Promise.resolve({ ok: false, error: `Unknown provider: ${provider}` });
}
