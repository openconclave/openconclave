import { describe, test, expect, mock, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync as realStatSync } from "fs";
import * as realFs from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

// TEST_LIMITATION: assigning a different-uid directory requires root; statSync is
// mocked to return an attacker-controlled uid, simulating a pre-placed cache
// directory owned by a different user on POSIX.

const FAKE_CONTENT = Buffer.from("#!/usr/bin/env node\n// fake cli for test");
const HASH = createHash("sha256").update(FAKE_CONTENT).digest("hex").slice(0, 16);
const CACHE_DIR = join(tmpdir(), `claude-agent-sdk-${HASH}`);
const CACHE_FILE = join(CACHE_DIR, "cli.js");
// Path containing "~BUN" triggers the bunfs extraction branch in resolveCliPathWithSource
const FAKE_BUNDLE = join(tmpdir(), `~BUN-test-cli-resolve-${process.pid}.js`);

describe("cli-resolve: uid ownership guard", () => {
  afterEach(() => {
    mock.restore();
    if (existsSync(FAKE_BUNDLE)) rmSync(FAKE_BUNDLE);
    if (existsSync(CACHE_DIR)) rmSync(CACHE_DIR, { recursive: true });
  });

  test("throws when cache dir uid differs from current process uid (POSIX only)", async () => {
    if (process.platform === "win32") return;

    const currentUid = process.getuid!();
    const attackerUid = currentUid === 0 ? 1000 : currentUid + 1;

    // Write fake bundle at a path that contains "~BUN" so the extraction branch runs
    writeFileSync(FAKE_BUNDLE, FAKE_CONTENT);
    // Attacker pre-creates cache dir with correct mode 0o700 and a malicious cli.js
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CACHE_FILE, "#!/usr/bin/env node\nmalicious()", { mode: 0o755 });

    // TEST_LIMITATION: assigning a different-uid directory requires root;
    // statSync is mocked to return an attacker-controlled uid.
    mock.module("fs", () => ({
      ...realFs,
      statSync: (path: string) => {
        const st = realStatSync(path);
        return path === CACHE_DIR ? { ...st, uid: attackerUid } : st;
      },
    }));

    const { resolveCliPathWithSource } = await import("../cli-resolve");
    expect(() => resolveCliPathWithSource(FAKE_BUNDLE)).toThrow(/owned by uid/);
  });
});
