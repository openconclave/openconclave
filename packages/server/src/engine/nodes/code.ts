import { AppError, ErrorCode } from "@openconclave/shared";
import type { CodeConfig } from "@openconclave/shared";
import { resolve, dirname } from "path";
import type { Workspace } from "../workspace";

export interface CodeNodeContext {
  workflowId: number;
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
  try {
    Bun.file(candidate).size; // throws if not found
    return candidate;
  } catch {
    return "bash"; // fallback
  }
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
    env: {
      ...process.env,
      INPUT: inputStr,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      ...(context ? {
        OC_API_URL: `http://localhost:${process.env.PORT ?? 4000}`,
        OC_WORKFLOW_ID: String(context.workflowId),
        OC_RUN_ID: String(context.runId),
        OC_NODE_ID: context.nodeId,
      } : {}),
    },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
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
