import {
  AppError,
  ErrorCode,
  API_PORT,
  DEFAULT_CODE_TIMEOUT_MS,
  DEFAULT_CODE_INPUT_MAX_BYTES,
} from "@openconclave/shared";
import type { CodeConfig } from "@openconclave/shared";
import { existsSync } from "fs";
import { resolve as pathResolve, dirname } from "path";
import type { Workspace } from "../workspace";
import { buildSubprocessEnv } from "../../agent/subprocess-env";
import { logger } from "../../lib/logger";

export interface CodeNodeContext {
  conclaveId: number;
  runId: number;
  nodeId: string;
}

const CODE_NODE_OUTPUT_CAP_BYTES = 4 * 1024 * 1024;
const CODE_NODE_STDERR_MAX_IN_ERROR = 4 * 1024;
// Windows CreateProcess hard-caps the full command line at ~32 KiB. Passing
// larger `code` via `-c` fails with cryptic ENAMETOOLONG. This is cross-platform
// (Linux ARG_MAX is higher but still finite) and honest — code blocks that
// large belong in a file.
const CODE_SOURCE_MAX_BYTES = 32 * 1024;

/** On Windows, resolve Git Bash so we never accidentally invoke WSL bash. */
function resolveGitBash(): { path: string; ok: boolean } {
  if (process.platform !== "win32") return { path: "bash", ok: true };
  const gitExe = Bun.which("git");
  if (!gitExe) return { path: "", ok: false };
  // git.exe is typically at <Git>/cmd/git.exe or <Git>/mingw{32,64}/bin/git.exe
  let gitRoot = dirname(dirname(gitExe));
  if (gitRoot.endsWith("mingw64") || gitRoot.endsWith("mingw32")) gitRoot = dirname(gitRoot);
  const candidate = pathResolve(gitRoot, "usr", "bin", "bash.exe");
  // Bun.file().size returns 0 for missing files — it does NOT throw
  // (Bun issue #589). Use an explicit existence check instead.
  if (existsSync(candidate)) return { path: candidate, ok: true };
  return { path: "", ok: false };
}

/**
 * Windows has a Microsoft Store App Execution Alias for `python` that's a
 * non-executable stub opening the Store when spawned. The `py` launcher,
 * installed by any real Python distribution, is the official way to pick a
 * real interpreter. Prefer it when available, and explicitly reject the
 * Store stub if it's all we find.
 */
function resolvePythonCommand(): { cmd: string[]; ok: boolean } {
  if (process.platform !== "win32") return { cmd: ["python3"], ok: true };
  const pyLauncher = Bun.which("py");
  if (pyLauncher) return { cmd: [pyLauncher, "-3"], ok: true };
  const python = Bun.which("python");
  if (python && !python.toLowerCase().includes("windowsapps")) {
    return { cmd: [python], ok: true };
  }
  return { cmd: [], ok: false };
}

let gitBashCache: { path: string; ok: boolean } | null = null;
function getGitBash(): { path: string; ok: boolean } {
  if (gitBashCache) return gitBashCache;
  gitBashCache = resolveGitBash();
  if (!gitBashCache.ok && process.platform === "win32") {
    logger.warn(
      "Git Bash not found — bash code nodes will refuse to run on Windows",
      { hint: "Install Git for Windows; falling back to `bash` would resolve to WSL." },
    );
  }
  return gitBashCache;
}

let pythonCmdCache: { cmd: string[]; ok: boolean } | null = null;
function getPythonCommand(): { cmd: string[]; ok: boolean } {
  if (!pythonCmdCache) pythonCmdCache = resolvePythonCommand();
  return pythonCmdCache;
}

/**
 * Signal the child's entire process group on POSIX (when spawned with
 * detached: true). On Windows, `process.kill(-pid)` isn't valid; fall back to
 * the single-process kill and accept that grandchildren may orphan there.
 */
function killTree(proc: ReturnType<typeof Bun.spawn>, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!proc || proc.pid == null) return;
  if (process.platform !== "win32") {
    try { process.kill(-proc.pid, signal); return; } catch { /* fall through */ }
  }
  try { proc.kill(signal); } catch { /* already dead */ }
}

export async function executeCode(
  config: CodeConfig,
  input: unknown,
  context: CodeNodeContext | undefined,
  workspace: Workspace,
): Promise<unknown> {
  if (!workspace) {
    // Never silently fall back to process.cwd() — that would let subprocess
    // code execute in the server's own directory instead of the run's.
    throw new AppError(
      ErrorCode.CODE_EXECUTION_FAILED,
      "executeCode requires a Workspace — caller must scope execution to a run",
    );
  }

  const { runtime, code } = config;
  if (Buffer.byteLength(code, "utf-8") > CODE_SOURCE_MAX_BYTES) {
    throw new AppError(
      ErrorCode.CODE_EXECUTION_FAILED,
      `Code source exceeds ${CODE_SOURCE_MAX_BYTES} bytes — Windows' command-line limit caps inline scripts; split into smaller pieces or write the script to a file and run it from a shorter runner.`,
    );
  }
  // Coerce top-level undefined to null so a moderator kickoff (no input, no
  // context) yields valid JSON "null" on stdin instead of misleading
  // "non-serializable" errors.
  const safeInput = input === undefined ? null : input;
  const payload = context ? { input: safeInput, context } : safeInput;
  let inputStr: string;
  try {
    if (typeof payload === "string") {
      inputStr = payload;
    } else {
      const stringified = JSON.stringify(payload);
      if (stringified === undefined) {
        throw new Error("payload contains non-serializable values (function / symbol)");
      }
      inputStr = stringified;
    }
  } catch (err: unknown) {
    throw new AppError(
      ErrorCode.CODE_EXECUTION_FAILED,
      `Code node input is not serializable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (Buffer.byteLength(inputStr, "utf-8") > DEFAULT_CODE_INPUT_MAX_BYTES) {
    throw new AppError(
      ErrorCode.CODE_EXECUTION_FAILED,
      `Code node input exceeds ${DEFAULT_CODE_INPUT_MAX_BYTES} bytes — truncate upstream before passing to a code node.`,
    );
  }

  let cmd: string[];
  if (runtime === "python") {
    const py = getPythonCommand();
    if (!py.ok) {
      throw new AppError(
        ErrorCode.CODE_INVALID_RUNTIME,
        "No usable Python interpreter found. Install the `py` launcher (ships with python.org installer) or put a non-Store `python` on PATH.",
      );
    }
    cmd = [...py.cmd, "-c", code];
  } else if (runtime === "node") {
    cmd = ["node", "-e", code];
  } else if (runtime === "bash") {
    const bash = getGitBash();
    if (!bash.ok) {
      throw new AppError(
        ErrorCode.CODE_INVALID_RUNTIME,
        "Git Bash not found on this host; refusing to spawn `bash` because the default Windows PATH would resolve it to WSL.",
      );
    }
    cmd = [bash.path, "-c", code];
  } else {
    throw new AppError(ErrorCode.CODE_INVALID_RUNTIME, `Unknown runtime: ${runtime}`);
  }

  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stderrReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    try {
      proc = Bun.spawn(cmd, {
        cwd: workspace.cwd,
        stdin: new Blob([inputStr]),
        stdout: "pipe",
        stderr: "pipe",
        // detached: true on POSIX puts the child in its own process group so we
        // can signal the whole tree (kill(-pgid)) on timeout — otherwise a code
        // node that backgrounds a grandchild (`tool & sleep 300`) leaves orphans
        // attached to the server. Windows has no equivalent here; tree-kill
        // would need Job Objects which Bun doesn't expose.
        ...(process.platform !== "win32" ? { detached: true } : {}),
        // Shared denylist (regex-based) — keeps ANTHROPIC_API_KEY, DATABASE_URL,
        // session secrets out of the subprocess. INPUT is carried via stdin, not
        // env, so large payloads don't blow the OS env-block limit (32 KiB hard
        // cap on Windows, shares ARG_MAX with argv on Linux/macOS).
        env: buildSubprocessEnv({
          ...(runtime === "python" ? { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } : {}),
          ...(context ? {
            OC_API_URL: process.env.OPENCONCLAVE_URL ?? `http://localhost:${API_PORT}`,
            OC_CONCLAVE_ID: String(context.conclaveId),
            OC_RUN_ID: String(context.runId),
            OC_NODE_ID: context.nodeId,
          } : {}),
        }),
      });
    } catch (err: unknown) {
      // Bun.spawn throws synchronously when cmd[0] is missing from PATH.
      // Wrap so callers see AppError like every other failure mode — but don't
      // double-wrap an AppError we emitted ourselves.
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCode.CODE_EXECUTION_FAILED,
        `Code node could not spawn ${runtime}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    stdoutReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();

    type Outcome =
      | {
          kind: "exit";
          stdout: string;
          stderr: string;
          stdoutTruncated: boolean;
          stderrTruncated: boolean;
          exitCode: number | null;
          signal: string | null;
        }
      | { kind: "timeout" };

    const normalRun: Promise<Outcome> = (async () => {
      const [stdoutRes, stderrRes] = await Promise.all([
        collectCapped(stdoutReader!, CODE_NODE_OUTPUT_CAP_BYTES),
        collectCapped(stderrReader!, CODE_NODE_OUTPUT_CAP_BYTES),
      ]);
      const exitCode = await proc!.exited;
      return {
        kind: "exit",
        stdout: stdoutRes.text,
        stderr: stderrRes.text,
        stdoutTruncated: stdoutRes.truncated,
        stderrTruncated: stderrRes.truncated,
        exitCode: exitCode ?? null,
        signal: proc!.signalCode ?? null,
      };
    })();
    // Swallow late rejections from the loser of Promise.race below. Without
    // this, a reader error that arrives after the timeout wins becomes an
    // unhandledRejection.
    normalRun.catch(() => { /* late loser — already timed out */ });

    const timeoutRun: Promise<Outcome> = new Promise((resolveTimeout) => {
      timeoutHandle = setTimeout(() => {
        // Race guard: if the child exited naturally in the last tick, don't
        // hijack the result with a spurious CODE_TIMEOUT. Leave timeoutRun
        // pending so Promise.race picks normalRun's real outcome.
        if (proc && proc.exitCode !== null) return;
        if (proc) killTree(proc, "SIGTERM");
        stdoutReader?.cancel().catch(() => { /* already done */ });
        stderrReader?.cancel().catch(() => { /* already done */ });
        resolveTimeout({ kind: "timeout" });
      }, DEFAULT_CODE_TIMEOUT_MS);
    });

    const outcome = await Promise.race([normalRun, timeoutRun]);

    if (outcome.kind === "timeout") {
      throw new AppError(
        ErrorCode.CODE_TIMEOUT,
        `Code node timed out after ${DEFAULT_CODE_TIMEOUT_MS / 1000}s (${runtime})`,
      );
    }

    if (outcome.exitCode !== 0) {
      const truncNote = outcome.stderrTruncated
        ? ` (stderr was truncated at ${CODE_NODE_OUTPUT_CAP_BYTES} bytes before this slice)`
        : "";
      const detail = outcome.stderr.length > CODE_NODE_STDERR_MAX_IN_ERROR
        ? outcome.stderr.slice(-CODE_NODE_STDERR_MAX_IN_ERROR) + "\n…(truncated)"
        : outcome.stderr;
      const exitDescriptor = outcome.signal
        ? `signal ${outcome.signal}`
        : `exit ${outcome.exitCode}`;
      throw new AppError(
        ErrorCode.CODE_EXECUTION_FAILED,
        `Code node failed (${runtime}, ${exitDescriptor})${truncNote}: ${detail}`,
      );
    }

    // Surface truncation as a structured failure rather than mangling the
    // payload: returning a mixed content+marker string would silently corrupt
    // JSON parses and smuggle the marker into downstream prompts.
    if (outcome.stdoutTruncated) {
      throw new AppError(
        ErrorCode.CODE_EXECUTION_FAILED,
        `Code node stdout exceeded ${CODE_NODE_OUTPUT_CAP_BYTES} bytes — write less or stream to a file.`,
      );
    }

    try {
      return JSON.parse(outcome.stdout.trim());
    } catch {
      return outcome.stdout.trim();
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    // If anything in the happy path threw, cancel any outstanding reads and
    // kill the subprocess rather than leaving it to run to completion.
    if (proc) {
      try {
        stdoutReader?.cancel().catch(() => { /* already done */ });
        stderrReader?.cancel().catch(() => { /* already done */ });
        if (proc.exitCode === null) {
          killTree(proc, "SIGTERM");
          // Grace window: a child that traps SIGTERM can hold up proc.exited
          // forever. Escalate to SIGKILL after a short wait and stop awaiting
          // so the caller's finally actually returns.
          const graceMs = 2_000;
          const settled = await Promise.race([
            proc.exited.then(() => "exited" as const).catch(() => "exited" as const),
            new Promise<"grace">((r) => setTimeout(() => r("grace"), graceMs)),
          ]);
          if (settled === "grace") {
            killTree(proc, "SIGKILL");
            logger.warn("Code node subprocess did not exit within grace window", {
              runtime,
              graceMs,
              runId: context?.runId,
            });
          }
        }
      } catch { /* best effort cleanup */ }
    }
  }
}

async function collectCapped(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  capBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const prevSize = size;
      size += value.byteLength;
      if (size > capBytes) {
        if (!truncated) {
          // Partial-chunk boundary: include exactly the bytes that fit under
          // cap instead of dropping the whole overflow chunk (which could be
          // up to a pipe buffer's worth — ~64 KiB).
          const remaining = capBytes - prevSize;
          if (remaining > 0) {
            out += decoder.decode(value.subarray(0, remaining), { stream: true });
          }
          truncated = true;
        }
        // Keep draining so the child doesn't block on a full pipe — just drop content.
        continue;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* already released or cancelled */ }
  }
  return { text: out, truncated };
}
