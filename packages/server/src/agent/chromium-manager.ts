/**
 * Downloads, caches, and launches a headless Chromium for the web_fetch tool.
 *
 * Uses @puppeteer/browsers for cross-platform install/locate (handles ZIP/DMG,
 * mac .app bundles, all arch combos), then drives the binary directly via CDP
 * over WebSocket — no Puppeteer or Playwright runtime dependency.
 */
import { spawn, type Subprocess } from "bun";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  install,
  computeExecutablePath,
  resolveBuildId,
  detectBrowserPlatform,
  Browser,
  ChromeReleaseChannel,
} from "@puppeteer/browsers";

import { WORKSPACE } from "../lib/workspace";
import { logger } from "../lib/logger";

const CHROMIUM_CACHE_DIR = join(WORKSPACE, "chromium");
const PROFILE_PREFIX = "oc-web-fetch-";
const LAUNCH_TIMEOUT_MS = 30_000;
// Clean up stale profile dirs older than this on startup (abandoned by crashed runs).
const STALE_PROFILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

let ensurePromise: Promise<string> | null = null;
// Cache resolved buildId so cold starts don't hit the network when Chromium is already installed.
let cachedBuildIdPath: string | null = null;

export async function ensureChromium(onProgress?: (msg: string) => void): Promise<string> {
  if (cachedBuildIdPath) return cachedBuildIdPath;
  if (ensurePromise) return ensurePromise;
  ensurePromise = doInstall(onProgress)
    .then((exe) => { cachedBuildIdPath = exe; return exe; })
    .finally(() => { ensurePromise = null; });
  return ensurePromise;
}

async function doInstall(onProgress?: (msg: string) => void): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);

  mkdirSync(CHROMIUM_CACHE_DIR, { recursive: true, mode: 0o700 });

  const buildId = await resolveBuildId(Browser.CHROMEHEADLESSSHELL, platform, ChromeReleaseChannel.STABLE);

  const exe = computeExecutablePath({
    browser: Browser.CHROMEHEADLESSSHELL,
    cacheDir: CHROMIUM_CACHE_DIR,
    platform,
    buildId,
  });

  // Already installed — skip download.
  if (await fileExists(exe)) return exe;

  onProgress?.(`Downloading Chromium ${buildId} for ${platform} …`);
  logger.info("Downloading Chromium", { platform, buildId });

  await install({
    browser: Browser.CHROMEHEADLESSSHELL,
    cacheDir: CHROMIUM_CACHE_DIR,
    platform,
    buildId,
    downloadProgressCallback: (downloaded, total) => {
      const pct = Math.round((downloaded / total) * 100);
      onProgress?.(`Downloading Chromium … ${pct}%`);
    },
  });

  onProgress?.(`Chromium ready: ${exe}`);
  logger.info("Chromium ready", { exe });
  return exe;
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/**
 * Sweep abandoned profile dirs from crashed runs. Only removes dirs older
 * than STALE_PROFILE_MAX_AGE_MS so active launches in other processes aren't
 * affected.
 */
function cleanStaleProfiles(): void {
  try {
    const now = Date.now();
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.startsWith(PROFILE_PREFIX)) continue;
      const full = join(tmpdir(), entry);
      try {
        const age = now - statSync(full).mtimeMs;
        if (age > STALE_PROFILE_MAX_AGE_MS) {
          rmSync(full, { recursive: true, force: true });
        }
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
}

// Track live profile dirs so process-exit handlers can clean them up even
// if the graceful shutdown path never runs.
const activeProfileDirs = new Set<string>();
let exitHandlerRegistered = false;

function registerExitHandler(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;
  const cleanup = () => {
    for (const dir of activeProfileDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
    activeProfileDirs.clear();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });
}

export type ChromiumProcess = {
  proc: Subprocess<"ignore", "pipe", "pipe">;
  profileDir: string;
  wsEndpoint: string;
};

export async function launchChromium(): Promise<ChromiumProcess> {
  cleanStaleProfiles();
  registerExitHandler();

  const exe = await ensureChromium();
  const profileDir = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  activeProfileDirs.add(profileDir);

  const proc = spawn({
    cmd: [
      exe,
      "--remote-debugging-port=0",
      // NOTE: --no-sandbox is required for chrome-headless-shell on Linux
      // without a setuid helper. On Windows/macOS it's a no-op. This tool
      // renders attacker-controllable URLs, so we rely on process isolation
      // (OC server boundary + SSRF guard) rather than the sandbox. If the
      // host runs untrusted workloads in the same process, DO NOT use this.
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const wsEndpoint = await readWsEndpoint(proc);
    // After capturing the DevTools line we still need to drain both streams
    // so Chromium doesn't block on pipe writes once the OS buffer fills.
    drainStream(proc.stdout, "stdout");
    drainStream(proc.stderr, "stderr");
    return { proc, profileDir, wsEndpoint };
  } catch (err) {
    // Startup failed — kill process, remove profile, re-throw with context.
    try { proc.kill(); } catch { /* */ }
    try { await proc.exited; } catch { /* */ }
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* */ }
    activeProfileDirs.delete(profileDir);
    throw err;
  }
}

async function readWsEndpoint(proc: Subprocess<"ignore", "pipe", "pipe">): Promise<string> {
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`chromium did not announce DevTools endpoint within ${LAUNCH_TIMEOUT_MS}ms (captured stderr: ${buf.slice(-500)})`);
      }
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("read timeout")), remaining),
      );
      let chunk;
      try {
        chunk = await Promise.race([reader.read(), timeoutPromise]);
      } catch {
        throw new Error(`chromium did not announce DevTools endpoint within ${LAUNCH_TIMEOUT_MS}ms (captured stderr: ${buf.slice(-500)})`);
      }
      if (chunk.done) throw new Error(`chromium exited before announcing DevTools endpoint (captured stderr: ${buf.slice(-500)})`);
      buf += decoder.decode(chunk.value, { stream: true });
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) return m[1]!;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Continuously drain a ReadableStream so the producer doesn't block on a
 * full OS pipe buffer. Failures are logged at debug level and swallowed —
 * the producer may have exited.
 */
function drainStream(stream: ReadableStream<Uint8Array>, label: string): void {
  void (async () => {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) return;
      }
    } catch (err) {
      logger.debug(`chromium ${label} drain ended`, { err: err instanceof Error ? err.message : String(err) });
    } finally {
      try { reader.releaseLock(); } catch { /* */ }
    }
  })();
}

export function releaseProfileDir(dir: string): void {
  activeProfileDirs.delete(dir);
}
