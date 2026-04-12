import { AppError, ErrorCode } from "@openconclave/shared";
import type { CodeConfig } from "@openconclave/shared";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import type { Workspace } from "../workspace";
import { buildSubprocessEnv } from "../../agent/runtime";

export interface CodeNodeContext {
  conclaveId: number;
  runId: number;
  nodeId: string;
}

/** On Windows, resolve Git Bash so we never accidentally invoke WSL bash. */
function resolveGitBash(): string {
  if (process.platform !== "win32") return "bash";
  const gitExe = Bun.which("git");
  if (!gitExe) return "bash"; // fallback
  // git.exe is typically at <Git>/cmd/git.exe or <Git>/mingw64/bin/git.exe
  let gitRoot = dirname(dirname(gitExe)); // up from cmd/ or bin/
  // If we landed in mingw64, go up one more
  if (gitRoot.endsWith("mingw64")) gitRoot = dirname(gitRoot);
  const candidate = resolve(gitRoot, "usr", "bin", "bash.exe");
  // Bun.file().size returns 0 for missing files — it does NOT throw
  // (Bun issue #589). Use an explicit existence check instead.
  if (existsSync(candidate)) return candidate;
  return "bash"; // fallback
}

const GIT_BASH = resolveGitBash();

export async function executeCode(config: CodeConfig, input: unknown, context?: CodeNodeContext, workspace?: Workspace): Promise<unknown> {
  const { runtime, code } = config;
  const payload = context ? { input, context } : input;
  const inputStr = typeof payload === "string" ? payload : (JSON.stringify(payload) ?? "");

  const cmdMap: Record<string, string[]> = {
    python: [process.platform === "win32" ? "python" : "python3", "-c", code],
    node: ["node", "-e", code],
    bash: [GIT_BASH, "-c", code],
  };

  const cmd = cmdMap[runtime];
  if (!cmd) {
    throw new AppError(ErrorCode.CODE_INVALID_RUNTIME, `Unknown runtime: ${runtime}`);
  }

  const proc = Bun.spawn(cmd, {
    cwd: workspace?.cwd ?? process.cwd(),
    stdin: new Blob([inputStr]),
    stdout: "pipe",
    stderr: "pipe",
    // Use the shared allowlist instead of wholesale process.env — otherwise
    // ANTHROPIC_API_KEY / DATABASE_URL / session secrets leak into user code.
    env: buildSubprocessEnv({
      INPUT: inputStr,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      ...(context ? {
        OC_API_URL: process.env.OPENCONCLAVE_URL ?? "http://localhost:4000",
        OC_CONCLAVE_ID: String(context.conclaveId),
        OC_RUN_ID: String(context.runId),
        OC_NODE_ID: context.nodeId,
      } : {}),
    }),
  });

  // Drain stdout and stderr concurrently. Sequential reads deadlock when
  // stderr exceeds the OS pipe buffer (~64KB): the subprocess blocks writing
  // to stderr while we're still waiting on stdout, neither side advances.
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new AppError(
      ErrorCode.CODE_EXECUTION_FAILED,
      `Code node failed (${runtime}, exit ${exitCode}): ${stderr}`
    );
  }

  try {
    return JSON.parse(stdout.trim());
  } catch {
    return stdout.trim();
  }
}
