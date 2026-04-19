import { logger } from "../lib/logger";

const DEFAULT_INDEX_URL = "https://raw.githubusercontent.com/openconclave/conclaves/main/index.json";
const INDEX_URL = process.env.OC_STARTER_INDEX_URL?.trim() || DEFAULT_INDEX_URL;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export interface MarketplaceRequires {
  providers?: string[];
  embeddings?: boolean;
}

export interface MarketplaceEntry {
  id: string;
  title: string;
  description: string;
  toolName?: string;
  tags?: string[];
  requires?: MarketplaceRequires;
  /** Relative path within the index's base; joined with baseUrl to fetch the definition. */
  path: string;
  /** Optional relative path for a thumbnail image. */
  image?: string;
}

export interface MarketplaceIndex {
  version: string;
  conclaves: MarketplaceEntry[];
}

/** Index enriched with absolute URLs so the client doesn't need to know the base. */
export interface ResolvedMarketplaceEntry extends MarketplaceEntry {
  definitionUrl: string;
  imageUrl: string | null;
}

interface CachedIndex {
  entries: ResolvedMarketplaceEntry[];
  fetchedAt: number;
  error: string | null;
}

let cache: CachedIndex | null = null;

export async function getMarketplaceIndex(force = false): Promise<CachedIndex> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  cache = await fetchIndex();
  return cache;
}

export async function getEntryById(id: string): Promise<ResolvedMarketplaceEntry | null> {
  const { entries } = await getMarketplaceIndex();
  return entries.find((e) => e.id === id) ?? null;
}

/** Fetch the raw conclave definition for an entry and return it verbatim. */
export async function fetchDefinition(entry: ResolvedMarketplaceEntry): Promise<unknown> {
  const res = await fetch(entry.definitionUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`definition http ${res.status}`);
  return await res.json();
}

// ── internals ─────────────────────────────────────────────────

async function fetchIndex(): Promise<CachedIndex> {
  try {
    const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`index http ${res.status}`);
    const raw = (await res.json()) as MarketplaceIndex;
    const entries = (raw.conclaves ?? []).map((e) => resolveEntry(e, INDEX_URL));
    logger.debug(`marketplace: loaded ${entries.length} entries`);
    return { entries, fetchedAt: Date.now(), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`marketplace fetch failed: ${message}`);
    return { entries: [], fetchedAt: Date.now(), error: message };
  }
}

function resolveEntry(entry: MarketplaceEntry, baseUrl: string): ResolvedMarketplaceEntry {
  const base = new URL(baseUrl);
  const definitionUrl = new URL(entry.path, base).toString();
  const imageUrl = entry.image ? new URL(entry.image, base).toString() : null;
  return { ...entry, definitionUrl, imageUrl };
}
