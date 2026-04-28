import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import embeddedCliPath from "@anthropic-ai/claude-agent-sdk/embed";
import { logger } from "../../lib/logger";

function findSystemClaude(): string | undefined {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = execFileSync(cmd, ["claude"], { encoding: "utf8", timeout: 3000 }).trim();
    const bin = result.split(/\r?\n/)[0];
    if (bin && existsSync(bin)) return bin;
  } catch {}
}

// SDK's extractFromBunfs only checks for "$bunfs" but Bun on Windows uses "B:/~BUN/".
// Re-extract here to cover both patterns.
export function resolveCliPathWithSource(path: string): { path: string; source: "system" | "embedded" | "passthrough" } {
  const system = findSystemClaude();
  if (system) return { path: system, source: "system" };
  if (!path.includes("$bunfs") && !path.includes("~BUN")) return { path, source: "passthrough" };
  let out: string | undefined;
  try {
    const content = readFileSync(path);
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const dir = join(tmpdir(), `claude-agent-sdk-${hash}`);
    out = join(dir, "cli.js");

    // Ensure the cache dir is safe BEFORE trusting anything inside it. Without
    // this, a pre-placed cli.js on the fast-path (existsSync(out)) bypasses the
    // mode check entirely, letting an attacker on a shared tmpdir execute
    // arbitrary code. mkdirSync is idempotent when the dir already exists.
    // Note: Windows has no POSIX mode bits — per-user %TEMP% is typically safe,
    // but a shared-tempdir environment (CI, service accounts) doesn't get the
    // same protection here.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      const st = statSync(dir);
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        throw new Error(`CLI cache dir ${dir} has mode ${mode.toString(8)}, expected 700`);
      }
      if (st.uid !== process.getuid!()) {
        throw new Error(`CLI cache dir ${dir} is owned by uid ${st.uid}, expected ${process.getuid!()}`);
      }
    }

    if (existsSync(out)) return { path: out, source: "embedded" };

    const tmp = join(dir, `cli.js.tmp.${process.pid}`);
    writeFileSync(tmp, content);
    try { chmodSync(tmp, 0o755); } catch (e) {
      // EPERM on chmod is expected on Windows (no POSIX bits); on POSIX we
      // just wrote the file ourselves, so an error here is real (SELinux,
      // noexec mount) and must not be swallowed.
      if (process.platform !== "win32") throw e;
      if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
    }
    renameSync(tmp, out);
    return { path: out, source: "embedded" };
  } catch (err) {
    // Honest-race recovery: if another process finished extracting before us,
    // their renameSync wins and ours hits EEXIST/EPERM. Only swallow THOSE
    // errors — if we're here because the cache dir had unsafe perms, the
    // existing file is the exact attack we're trying to defend against.
    const code = (err as NodeJS.ErrnoException).code;
    const isRaceError = code === "EEXIST" || code === "EPERM";
    if (isRaceError && out && existsSync(out)) {
      return { path: out, source: "embedded" };
    }
    // Any other failure (disk full, permission denied, bad mode) is fatal —
    // returning the bunfs path would let the SDK try to spawn it and fail
    // with a cryptic "no such file" later.
    throw err;
  }
}

// Lazy-initialize so importing this module for its types (or in tests) doesn't
// shell out to `which claude`, hash the embedded bundle, or touch tmpdir. A
// resolveCliPath failure at module-load would take down the whole server boot
// path before any handler could report it.
let _cliPath: string | undefined;
export function getCliPath(): string {
  if (_cliPath === undefined) {
    const r = resolveCliPathWithSource(embeddedCliPath);
    _cliPath = r.path;
    logger.info("Claude CLI resolved", { path: r.path, source: r.source });
  }
  return _cliPath;
}
