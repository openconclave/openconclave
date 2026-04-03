import { AppError, ErrorCode } from "@openconclave/shared";
import type { CodeConfig } from "@openconclave/shared";

export interface CodeNodeContext {
  workflowId: number;
  runId: number;
  nodeId: string;
}

const AGENT_CWD = process.cwd();

export async function executeCode(config: CodeConfig, input: unknown, context?: CodeNodeContext): Promise<unknown> {
  const { runtime, code } = config;
  const payload = context ? { input, context } : input;
  const inputStr = typeof payload === "string" ? payload : (JSON.stringify(payload) ?? "");

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
