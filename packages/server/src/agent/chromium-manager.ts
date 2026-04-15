/**
 * Downloads, caches, and launches a headless Chromium for the web_fetch tool.
 *
 * Uses @puppeteer/browsers for cross-platform install/locate (handles ZIP/DMG,
 * mac .app bundles, all arch combos), then drives the binary directly via CDP
 * over WebSocket — no Puppeteer or Playwright runtime dependency.
 */
import { spawn, type Subprocess } from "bun";
import { mkdirSync, mkdtempSync } from "fs";
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

let ensurePromise: Promise<string> | null = null;

export async function ensureChromium(onProgress?: (msg: string) => void): Promise<string> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = doInstall(onProgress).finally(() => { ensurePromise = null; });
  return ensurePromise;
}

async function doInstall(onProgress?: (msg: string) => void): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);

  mkdirSync(CHROMIUM_CACHE_DIR, { recursive: true });

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

export type ChromiumProcess = {
  proc: Subprocess<"ignore", "pipe", "pipe">;
  profileDir: string;
  wsEndpoint: string;
};

export async function launchChromium(): Promise<ChromiumProcess> {
  const exe = await ensureChromium();
  const profileDir = mkdtempSync(join(tmpdir(), "oc-web-fetch-"));
  const proc = spawn({
    cmd: [
      exe,
      "--remote-debugging-port=0",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  const wsEndpoint = await readWsEndpoint(proc);
  return { proc, profileDir, wsEndpoint };
}

async function readWsEndpoint(proc: Subprocess<"ignore", "pipe", "pipe">): Promise<string> {
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("chromium exited before announcing DevTools endpoint");
    buf += decoder.decode(value, { stream: true });
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { reader.releaseLock(); return m[1]!; }
  }
}
