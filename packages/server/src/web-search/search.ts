import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { settings } from "../db/schema";
import { searchSearxng } from "./providers/searxng";
import { searchTavily } from "./providers/tavily";
import { searchSerper } from "./providers/serper";
import { searchLinkup } from "./providers/linkup";
import type { SearchOptions, SearchResponse, WebSearchProviderId } from "./types";

export class WebSearchNotConfiguredError extends Error {
  constructor() {
    super("Web search is not configured. Enable it in Settings → Web search.");
    this.name = "WebSearchNotConfiguredError";
  }
}

export class WebSearchTimeoutError extends Error {
  constructor(timeoutSecs: number) {
    super(`Web search timed out after ${timeoutSecs}s`);
    this.name = "WebSearchTimeoutError";
  }
}

const TIMEOUT_MS = 10_000;

interface ResolvedConfig {
  provider: Exclude<WebSearchProviderId, "none">;
  credential: string;
}

async function getSetting(key: string): Promise<string | null> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

const CREDENTIAL_KEY: Record<Exclude<WebSearchProviderId, "none">, string> = {
  searxng: "web_search_searxng_url",
  tavily: "web_search_tavily_key",
  serper: "web_search_serper_key",
  linkup: "web_search_linkup_key",
};

/** Load provider + credential from settings. Returns null if unconfigured. */
export async function resolveWebSearchConfig(): Promise<ResolvedConfig | null> {
  const provider = (await getSetting("web_search_provider")) as WebSearchProviderId | null;
  if (!provider || provider === "none") return null;
  const credential = await getSetting(CREDENTIAL_KEY[provider]);
  if (!credential) return null;
  return { provider, credential };
}

/** Run a web search using the configured provider. Applies a 10s timeout. */
export async function searchWeb(query: string, opts: SearchOptions = {}): Promise<SearchResponse & { provider: string; tookMs: number }> {
  const config = await resolveWebSearchConfig();
  if (!config) {
    throw new WebSearchNotConfiguredError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await dispatch(config.provider, config.credential, query, {
      ...opts,
      signal: controller.signal,
    });
    return { ...response, provider: config.provider, tookMs: Math.round(performance.now() - started) };
  } catch (err) {
    if (controller.signal.aborted) throw new WebSearchTimeoutError(TIMEOUT_MS / 1000);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function dispatch(
  provider: Exclude<WebSearchProviderId, "none">,
  credential: string,
  query: string,
  opts: SearchOptions,
): Promise<SearchResponse> {
  if (provider === "searxng") return searchSearxng(credential, query, opts);
  if (provider === "tavily") return searchTavily(credential, query, opts);
  if (provider === "serper") return searchSerper(credential, query, opts);
  if (provider === "linkup") return searchLinkup(credential, query, opts);
  throw new Error(`Unknown web search provider: ${provider as string}`);
}
