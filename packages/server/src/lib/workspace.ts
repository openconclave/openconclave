import { mkdirSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";

/**
 * All OpenConclave data lives under .openconclave/.
 *
 * When running from ~/.openconclave/bin/ (installed), data goes in ~/.openconclave/.
 * Otherwise (dev mode), data goes in <cwd>/.openconclave/.
 */
function resolveWorkspace(): string {
  // Explicit override wins. Used by the Claude Code plugin (OC_DATA_DIR is set
  // to ${CLAUDE_PLUGIN_DATA}) and by advanced standalone users.
  if (process.env.OC_DATA_DIR) {
    return process.env.OC_DATA_DIR;
  }
  const homeOc = join(homedir(), ".openconclave");
  const execDir = dirname(process.execPath);
  // Installed compiled binary at ~/.openconclave/bin/ uses ~/.openconclave/ data.
  if (execDir === join(homeOc, "bin")) {
    return homeOc;
  }
  // Dev fallback.
  return join(process.cwd(), ".openconclave");
}

export const WORKSPACE = resolveWorkspace();
export const OUTPUTS_DIR = join(WORKSPACE, "outputs");
export const SESSIONS_DIR = join(WORKSPACE, "sessions");
export const TMP_DIR = join(WORKSPACE, "tmp");
export const DB_PATH = join(WORKSPACE, "openconclave.db");

// Ensure directories exist on import
mkdirSync(OUTPUTS_DIR, { recursive: true });
mkdirSync(SESSIONS_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

export function sessionDirForRun(runId: number | string): string {
  const dir = join(SESSIONS_DIR, String(runId));
  mkdirSync(join(dir, "attachments"), { recursive: true });
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  return dir;
}

export type AttachmentInput = { filename: string; contentBase64: string };
export type SavedAttachment = { filename: string; path: string; size: number };

export function saveAttachmentsForRun(
  runId: number | string,
  attachments: AttachmentInput[] | undefined
): SavedAttachment[] {
  if (!attachments?.length) return [];
  const attachDir = join(sessionDirForRun(runId), "attachments");
  return attachments.map((a) => {
    const safeName = basename(a.filename).replace(/[^\w.\-]/g, "_");
    const path = join(attachDir, safeName);
    const bytes = Buffer.from(a.contentBase64, "base64");
    writeFileSync(path, bytes);
    return { filename: safeName, path, size: bytes.length };
  });
}
