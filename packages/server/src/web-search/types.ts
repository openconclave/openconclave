export type WebSearchProviderId = "none" | "searxng" | "tavily" | "serper" | "linkup";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engines?: string[];
  publishedDate?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  engines?: string[];
}

export interface SearchOptions {
  limit?: number;
  language?: string;
  signal?: AbortSignal;
}

export interface TestResult {
  ok: boolean;
  latencyMs?: number;
  sampleTitles?: string[];
  engines?: string[];
  error?: string;
  warn?: string;
}
