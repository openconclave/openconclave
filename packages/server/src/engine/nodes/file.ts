import { isAbsolute } from "path";
import { readFileSync } from "fs";
import type { WorkflowNode } from "@openconclave/shared";
import { logger } from "../../lib/logger";

export function executeFile(node: WorkflowNode): unknown {
  const fileConfig = node.data.config as { path: string };
  const filePath = fileConfig.path;

  if (!filePath) {
    return "Error: no file path configured";
  }

  if (!isAbsolute(filePath)) {
    logger.warn("File node has relative path — use absolute paths", { path: filePath });
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("File node read failed", { path: filePath, error: msg });
    return `Error reading file: ${msg}`;
  }
}
