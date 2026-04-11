#!/usr/bin/env bun
// Bump the project version in a single shot.
//
// Updates:
//   packages/shared/src/version.ts        (code source of truth)
//   packages/shared/package.json          (workspace metadata)
//   packages/server/package.json          (workspace metadata)
//   packages/client/package.json          (workspace metadata)
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

async function bumpJson(relPath: string) {
  const path = join(ROOT, relPath);
  const text = await Bun.file(path).text();
  const data = JSON.parse(text);
  data.version = version;
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ✓ ${relPath.replace(/\\/g, "/")}  →  ${version}`);
}

const versionTs = join(ROOT, "packages/shared/src/version.ts");
await Bun.write(versionTs, `export const VERSION = "${version}";\n`);
console.log(`  ✓ packages/shared/src/version.ts  →  ${version}`);

await bumpJson("packages/shared/package.json");
await bumpJson("packages/server/package.json");
await bumpJson("packages/client/package.json");

console.log(`\nVersion bumped to ${version}`);
