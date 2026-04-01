import { AppError, ErrorCode } from "@openconclave/shared";
import type { CodeConfig } from "@openconclave/shared";

const AGENT_CWD = process.cwd();

export async function executeCode(config: CodeConfig, input: unknown): Promise<unknown> {
  const { runtime, code } = config;
  const inputStr = typeof input === "string" ? input : (JSON.stringify(input) ?? "");

  const cmdMap: Record<string, string[]> = {
    python: ["python3", "-c", code],
    node: ["node", "-e", code],
    bash: ["bash", "-c", code],
  };

  const cmd = cmdMap[runtime];
  if (!cmd) {
    throw new AppError(ErrorCode.CODE_INVALID_RUNTIME, `Unknown runtime: ${runtime}`);
  }

  const proc = Bun.spawn(cmd, {
    cwd: AGENT_CWD,
    stdin: new Blob([inputStr]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, INPUT: inputStr },
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
