#!/usr/bin/env bun
// Bump the project version in a single shot.
//
// Updates:
//   packages/shared/src/version.ts        (code source of truth)
//   packages/shared/package.json          (workspace metadata)
//   packages/server/package.json          (workspace metadata)
//   packages/client/package.json          (workspace metadata)
//   .claude-plugin/plugin.json            (Claude Code plugin manifest, top-level version)
//   .claude-plugin/marketplace.json       (marketplace manifest, metadata.version)
//
// Usage:
//   bun run scripts/bump-version.ts v1.0.8
//   bun run scripts/bump-version.ts 1.0.8
import { join } from "path";

const raw = process.argv[2];
if (!raw) {
  console.error("usage: bun run scripts/bump-version.ts <version>   e.g. v1.0.8");
  process.exit(1);
}

const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Invalid version: ${raw}. Expected semver like 1.0.8 or v1.0.8.`);
  process.exit(1);
}

const ROOT = join(import.meta.dir, "..");

// Set the value at a dotted JSON path (e.g. "metadata.version") to `version`.
// Traverses existing intermediate objects only — refuses to create or overwrite
// non-objects so a manifest with the wrong shape is loud, not silently mangled.
function setAt(obj: Record<string, unknown>, path: string, value: string): void {
  const keys = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const next = cursor[k];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw new Error(`bumpJson: path "${path}" — "${k}" is not an object`);
    }
    cursor = next as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}

async function bumpJson(relPath: string, jsonPath = "version") {
  const path = join(ROOT, relPath);
  const text = await Bun.file(path).text();
  const data = JSON.parse(text);
  setAt(data, jsonPath, version);
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
  const suffix = jsonPath === "version" ? "" : ` (${jsonPath})`;
  console.log(`  ✓ ${relPath.replace(/\\/g, "/")}${suffix}  →  ${version}`);
}

const versionTs = join(ROOT, "packages/shared/src/version.ts");
await Bun.write(versionTs, `export const VERSION = "${version}";\n`);
console.log(`  ✓ packages/shared/src/version.ts  →  ${version}`);

await bumpJson("packages/shared/package.json");
await bumpJson("packages/server/package.json");
await bumpJson("packages/client/package.json");
await bumpJson(".claude-plugin/plugin.json");
await bumpJson(".claude-plugin/marketplace.json", "metadata.version");

console.log(`\nVersion bumped to ${version}`);
