import { dirname } from "path";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { WorkflowNode } from "@openconclave/shared";
import { logger } from "../../lib/logger";
import type { Workspace } from "../workspace";

export function executeFile(node: WorkflowNode, input: unknown, workspace?: Workspace): unknown {
  const fileConfig = node.data.config as { path: string; mode?: "read" | "write" };
  const filePath = fileConfig.path;
  const mode = fileConfig.mode ?? "read";

  if (!filePath) {
    return "Error: no file path configured";
  }

  const resolvedPath = workspace ? workspace.resolve(filePath) : filePath;

  if (mode === "write") {
    try {
      mkdirSync(dirname(resolvedPath), { recursive: true });
      const content = typeof input === "string" ? input : JSON.stringify(input, null, 2);
      writeFileSync(resolvedPath, content, "utf8");
      logger.info("File node wrote output", { path: resolvedPath, bytes: content.length });
      return `File saved to ${resolvedPath}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("File node write failed", { path: resolvedPath, error: msg });
      return `Error writing file: ${msg}`;
    }
  }

  try {
    return readFileSync(resolvedPath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("File node read failed", { path: resolvedPath, error: msg });
    return `Error reading file: ${msg}`;
  }
}
