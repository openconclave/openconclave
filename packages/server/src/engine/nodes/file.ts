import { join, isAbsolute } from "path";
import { readFileSync } from "fs";
import type { WorkflowNode } from "@openconclave/shared";
import { logger } from "../../lib/logger";

export function executeFile(node: WorkflowNode, callerCwd?: string): unknown {
  const fileConfig = node.data.config as { path: string };
  try {
    const filePath = fileConfig.path;
    const resolvedPath = isAbsolute(filePath)
      ? filePath
      : join(callerCwd ?? process.cwd(), filePath);
    return readFileSync(resolvedPath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("File node read failed", { path: fileConfig.path, error: msg });
    return `Error reading file: ${msg}`;
  }
}
