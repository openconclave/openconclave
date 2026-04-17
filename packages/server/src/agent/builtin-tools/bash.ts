import { spawn } from "bun";
import { buildSubprocessEnv } from "../subprocess-env";
import type { BuiltinTool } from "./types";

const BASH_TIMEOUT_MS = 60_000;
const BASH_OUTPUT_CAP_BYTES = 4 * 1024 * 1024;

export function buildBashTool(cwd: string): Record<string, BuiltinTool> {
  return {
    bash: {
      tool: {
        type: "function",
        function: {
          name: "bash",
          description:
            `Run a shell command and return its output. Wall-clock timeout ${BASH_TIMEOUT_MS / 1000}s; output capped at ${BASH_OUTPUT_CAP_BYTES / (1024 * 1024)}MB per stream.`,
          parameters: {
            type: "object",
            required: ["command"],
            properties: {
              command: { type: "string", description: "The shell command to execute" },
            },
          },
        },
      },
      execute: async (args) => {
        const command = typeof args.command === "string" ? args.command : "";
        if (!command) return "Error: command is required (non-empty string).";
        return runBash(command, cwd);
      },
    },
  };
}

/**
 * Run bash under an allowlisted env with concurrent pipe drain, wall-clock
 * timeout, and per-stream output cap. Returns a human-readable result string.
 *
 * The three concerns — sequential drain deadlocks on large stderr, absent
 * timeout lets long commands pin the caller, and inherited env leaks secrets
 * to the subprocess — are addressed together because they share the spawn call.
 */
export async function runBash(
  command: string,
  cwd: string,
  opts: { timeoutMs?: number; outputCapBytes?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? BASH_TIMEOUT_MS;
  const capBytes = opts.outputCapBytes ?? BASH_OUTPUT_CAP_BYTES;
  let proc: ReturnType<typeof spawn> | undefined;
  let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stderrReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    proc = spawn({
      cmd: ["bash", "-c", command],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: buildSubprocessEnv(),
    });

    stdoutReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();

    type Outcome =
      | { kind: "exit"; stdout: string; stderr: string; exitCode: number }
      | { kind: "timeout" };

    const normalRun: Promise<Outcome> = (async () => {
      const [stdoutRes, stderrRes, exitCode] = await Promise.all([
        collectCappedFromReader(stdoutReader!, capBytes),
        collectCappedFromReader(stderrReader!, capBytes),
        proc!.exited,
      ]);
      return { kind: "exit", stdout: stdoutRes.text, stderr: stderrRes.text, exitCode };
    })();

    // On timeout, kill the process AND cancel the readers. Cancelling makes
    // any pending `read()` return {done: true}, so collectCappedFromReader exits
    // its loop and releases the lock in finally. Without cancel, on Windows where
    // kill often doesn't propagate to grandchildren, the reader would stay locked
    // indefinitely.
    const timeoutRun: Promise<Outcome> = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        try { proc?.kill(); } catch { /* already dead */ }
        stdoutReader?.cancel().catch(() => { /* reader might already be done */ });
        stderrReader?.cancel().catch(() => { /* reader might already be done */ });
        resolve({ kind: "timeout" });
      }, timeoutMs);
    });

    const outcome = await Promise.race([normalRun, timeoutRun]);

    if (outcome.kind === "timeout") {
      return `Error: command timed out after ${timeoutMs / 1000}s (process killed).`;
    }

    if (outcome.exitCode === 0) return outcome.stdout || "(no output)";

    const parts = [`Error (exit ${outcome.exitCode})`];
    if (outcome.stdout) parts.push(`--- stdout ---\n${outcome.stdout}`);
    if (outcome.stderr) parts.push(`--- stderr ---\n${outcome.stderr}`);
    return parts.join("\n");
  } catch (err: unknown) {
    try { proc?.kill(); } catch { /* already dead */ }
    // Same rationale as the timeout branch: if proc.exited rejected or a reader
    // erred, the other reader may still be pending. Cancel both so their locks
    // release through collectCappedFromReader's finally.
    stdoutReader?.cancel().catch(() => { /* already done */ });
    stderrReader?.cancel().catch(() => { /* already done */ });
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    // Unconditionally clear the timer — on any success, error, or early return
    // path — so it doesn't fire later holding proc + reader closures.
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function collectCappedFromReader(
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
      size += value.byteLength;
      if (size > capBytes) {
        truncated = true;
        // Keep draining to let the process exit cleanly — dropping content only.
        continue;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* already released or cancelled */ }
  }
  if (truncated) out += `\n\n…(output truncated at ${capBytes} bytes)`;
  return { text: out, truncated };
}
