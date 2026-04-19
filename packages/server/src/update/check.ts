import { VERSION } from "@openconclave/shared";
import { logger } from "../lib/logger";

const DEFAULT_MANIFEST_URL = "https://openconclave.com/releases/latest.json";
const MANIFEST_URL = process.env.OC_UPDATE_MANIFEST_URL?.trim() || DEFAULT_MANIFEST_URL;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

export interface ReleaseDownload {
  url: string;
  sha256?: string;
}

export interface ReleaseManifest {
  channel: string;
  version: string;
  releasedAt?: string;
  notesUrl?: string;
  downloads?: Record<string, ReleaseDownload>;
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  channel: string;
  releasedAt: string | null;
  notesUrl: string | null;
  downloadUrl: string | null;
  checkedAt: string;
  error: string | null;
}

let cached: UpdateStatus = emptyStatus(null);
let timer: Timer | null = null;

export function getCachedStatus(): UpdateStatus {
  return cached;
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  try {
    const res = await fetch(MANIFEST_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": `openconclave/${VERSION}` },
    });
    if (!res.ok) throw new Error(`manifest http ${res.status}`);
    const manifest = (await res.json()) as ReleaseManifest;
    cached = toStatus(manifest);
    logger.debug(`update check: latest=${cached.latest} hasUpdate=${cached.hasUpdate}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cached = { ...emptyStatus(message), checkedAt: new Date().toISOString() };
    logger.debug(`update check failed: ${message}`);
  }
  return cached;
}

export function startUpdateChecker(): void {
  if (timer) return;
  // Fire once immediately, then on an interval. Never throws — errors are cached.
  void checkForUpdate();
  timer = setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
}

// ── internals ──────────────────────────────────────────────────

function emptyStatus(error: string | null): UpdateStatus {
  return {
    current: VERSION,
    latest: null,
    hasUpdate: false,
    channel: "latest",
    releasedAt: null,
    notesUrl: null,
    downloadUrl: null,
    checkedAt: new Date().toISOString(),
    error,
  };
}

function toStatus(manifest: ReleaseManifest): UpdateStatus {
  const platformKey = `${process.platform}-${process.arch}`;
  const download = manifest.downloads?.[platformKey] ?? null;
  return {
    current: VERSION,
    latest: manifest.version,
    hasUpdate: compareSemver(manifest.version, VERSION) > 0,
    channel: manifest.channel ?? "latest",
    releasedAt: manifest.releasedAt ?? null,
    notesUrl: manifest.notesUrl ?? null,
    downloadUrl: download?.url ?? null,
    checkedAt: new Date().toISOString(),
    error: null,
  };
}

/**
 * Compare dotted numeric versions. Returns 1 if a > b, -1 if a < b, 0 if equal.
 * Ignores pre-release suffixes. OC uses plain `major.minor.patch`.
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/, "").split(/[.-]/, 3).map((s) => parseInt(s, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}
