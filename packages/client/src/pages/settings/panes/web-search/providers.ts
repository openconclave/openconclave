export type WebSearchProviderId = "none" | "searxng" | "tavily" | "serper" | "linkup";

export interface WebSearchProviderInfo {
  id: WebSearchProviderId;
  name: string;
  tagline: string;
  credential: "url" | "key" | "none";
  recommended?: boolean;
  free?: string;
  docsUrl?: string;
}

export const WEB_SEARCH_PROVIDERS: WebSearchProviderInfo[] = [
  {
    id: "searxng",
    name: "SearXNG",
    tagline: "Self-hosted metasearch. Aggregates Google, DuckDuckGo, Brave and more.",
    credential: "url",
    recommended: true,
    free: "Free — you run it",
    docsUrl: "https://docs.searxng.org/",
  },
  {
    id: "tavily",
    name: "Tavily",
    tagline: "AI-optimized search. Returns clean snippets ready for agents.",
    credential: "key",
    free: "1,000 searches / month free",
    docsUrl: "https://tavily.com/",
  },
  {
    id: "serper",
    name: "Serper",
    tagline: "Cheapest Google SERP API. Raw results, sub-2s latency.",
    credential: "key",
    free: "2,500 searches on signup",
    docsUrl: "https://serper.dev/",
  },
  {
    id: "linkup",
    name: "Linkup",
    tagline: "EU/GDPR-friendly. Standard + Deep search modes.",
    credential: "key",
    free: "€5 free credits / month",
    docsUrl: "https://linkup.so/",
  },
  {
    id: "none",
    name: "None",
    tagline: "Disable web search. Agents won't be able to reach the web.",
    credential: "none",
  },
];

export const SETTINGS_KEYS = {
  provider: "web_search_provider",
  searxngUrl: "web_search_searxng_url",
  tavilyKey: "web_search_tavily_key",
  serperKey: "web_search_serper_key",
  linkupKey: "web_search_linkup_key",
} as const;

export function keyFor(provider: WebSearchProviderId): string | null {
  if (provider === "searxng") return SETTINGS_KEYS.searxngUrl;
  if (provider === "tavily") return SETTINGS_KEYS.tavilyKey;
  if (provider === "serper") return SETTINGS_KEYS.serperKey;
  if (provider === "linkup") return SETTINGS_KEYS.linkupKey;
  return null;
}
