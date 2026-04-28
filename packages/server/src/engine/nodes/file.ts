import { dirname } from "path";
import { readFile, writeFile, mkdir, stat } from "fs/promises";
import { AppError, ErrorCode } from "@openconclave/shared";
import type { ConclaveNode, FileConfig } from "@openconclave/shared";
import { logger } from "../../lib/logger";
import type { Workspace } from "../workspace";

const FILE_NODE_READ_CAP_BYTES = 4 * 1024 * 1024;

export async function executeFile(
  node: ConclaveNode,
  input: unknown,
  workspace: Workspace,
): Promise<unknown> {
  const fileConfig = node.data.config as FileConfig;
  const filePath = fileConfig.path;
  const mode = fileConfig.mode ?? "read";
  const encoding = (fileConfig.encoding ?? "utf8") as BufferEncoding;

  if (!filePath) {
    throw new AppError(ErrorCode.VALIDATION, "File node: no file path configured");
  }

  const resolvedPath = workspace.resolveInside(filePath);

  if (mode === "write") {
    await mkdir(dirname(resolvedPath), { recursive: true });
    if (input instanceof Uint8Array) {
      await writeFile(resolvedPath, input);
      logger.info("File node wrote output", { path: resolvedPath, bytes: input.byteLength });
    } else {
      const content = typeof input === "string" ? input : JSON.stringify(input, null, 2);
      await writeFile(resolvedPath, content, encoding);
      logger.info("File node wrote output", { path: resolvedPath, bytes: Buffer.byteLength(content, encoding) });
    }
    return input;
  }

  if (mode === "read") {
    const info = await stat(resolvedPath);
    if (info.size > FILE_NODE_READ_CAP_BYTES) {
      throw new AppError(
        ErrorCode.INTERNAL,
        `File node: ${filePath} (${info.size} bytes) exceeds read cap of ${FILE_NODE_READ_CAP_BYTES} bytes`,
      );
    }
    return await readFile(resolvedPath, encoding);
  }

  throw new AppError(ErrorCode.VALIDATION, `File node: unknown mode "${mode}"`);
}
