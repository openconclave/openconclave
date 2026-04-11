#!/usr/bin/env bun
/**
 * Build release binaries for OpenConclave.
 *
 * Produces a single self-contained binary per platform.
 * Client assets are embedded into the binary — no external files needed.
 *
 * Usage:
 *   bun run scripts/build-release.ts                 # current platform only
 *   bun run scripts/build-release.ts --all           # all platforms
 *   bun run scripts/build-release.ts --target darwin-arm64
 */
import { $ } from "bun";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const CLI_ENTRY = "packages/server/src/cli.ts";
const ICON = join(ROOT, "packages", "client", "public", "favicon.ico");

type Target = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "windows-x64";

const ALL_TARGETS: Target[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "windows-x64",
];

function currentTarget(): Target {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  return `${os}-${arch}` as Target;
}

function ext(target: Target): string {
  return target.startsWith("windows") ? ".exe" : "";
}

// ── Parse args ──────────────────────────────────────────────
const args = process.argv.slice(2);
let targets: Target[];

if (args.includes("--all")) {
  targets = ALL_TARGETS;
} else if (args.includes("--target")) {
  const idx = args.indexOf("--target");
  const t = args[idx + 1] as Target;
  if (!ALL_TARGETS.includes(t)) {
    console.error(`Unknown target: ${t}. Valid: ${ALL_TARGETS.join(", ")}`);
    process.exit(1);
  }
  targets = [t];
} else {
  targets = [currentTarget()];
}

console.log(`\n  Building OpenConclave release`);
console.log(`  Targets: ${targets.join(", ")}\n`);

// ── Step 1: Build client ────────────────────────────────────
console.log("  [1/4] Building client...");
await $`cd ${join(ROOT, "packages", "client")} && bunx vite build`.quiet();
console.log("  [1/4] Client built\n");

// ── Step 2: Embed client assets into server ─────────────────
console.log("  [2/4] Embedding client assets...");
await $`cd ${ROOT} && bun run scripts/embed-client.ts`.quiet();

// Verify the generated file exists
const embeddedFile = join(ROOT, "packages", "server", "src", "embedded-assets.ts");
if (!existsSync(embeddedFile)) {
  console.error("  ERROR: embedded-assets.ts was not generated");
  process.exit(1);
}
const stats = Bun.file(embeddedFile);
console.log(`  [2/4] Assets embedded (${(stats.size / 1024).toFixed(0)} KB source)\n`);

// ── Step 3: Cross-compile single binary per platform ────────
console.log("  [3/4] Compiling binaries...");

// Per-target wipe (not full dist/) so a File Explorer / antivirus handle on
// the parent dir — common on Windows — doesn't block the build.
for (const target of targets) {
  const targetDir = join(DIST, target);
  if (existsSync(targetDir)) {
    try { rmSync(targetDir, { recursive: true }); } catch { /* handle held — will overwrite files */ }
  }
  mkdirSync(targetDir, { recursive: true });

  const outfile = join(targetDir, `oc${ext(target)}`);
  const bunTarget = `bun-${target === "windows-x64" ? "windows-x64-baseline" : target}`;
  if (target.startsWith("windows")) {
    await $`cd ${ROOT} && bun build --compile ${CLI_ENTRY} --outfile ${outfile} --target ${bunTarget} --windows-icon ${ICON} --windows-title OpenConclave`.quiet();
  } else {
    await $`cd ${ROOT} && bun build --compile ${CLI_ENTRY} --outfile ${outfile} --target ${bunTarget}`.quiet();
  }

  const file = Bun.file(outfile);
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  console.log(`    ✓ ${target}/oc${ext(target)}  ${sizeMB} MB`);
}

console.log("\n  [3/4] Binaries compiled\n");

// ── Step 4: Restore stub for dev mode ───────────────────────
const stub = `// Stub for dev mode — replaced by scripts/embed-client.ts at build time
export function getAsset(_path: string): { body: Uint8Array; type: string } | null {
  return null;
}
export const hasEmbeddedAssets = false;
`;
await Bun.write(embeddedFile, stub);
console.log("  [4/4] Restored dev stub for embedded-assets.ts\n");

// ── Summary ─────────────────────────────────────────────────
console.log("  Done! Single binary per platform — no external files needed.\n");
console.log("  Usage:");
console.log("    ./oc              # start server (API + UI on :4000)");
console.log("    ./oc mcp          # MCP server for Claude Code");
console.log("    ./oc channel      # channel bridge for Claude Code\n");
