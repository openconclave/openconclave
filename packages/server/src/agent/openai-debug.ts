import { appendFileSync } from "fs";
import { join } from "path";
import { SESSIONS_DIR } from "../lib/workspace";

export const DEBUG = process.env.OPENCONCLAVE_DEBUG === "1";
const OPENAI_LOG = join(SESSIONS_DIR, "openai-debug.log");

export function openaiLog(label: string, data: unknown): void {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${label}: ${JSON.stringify(data, null, 2)}\n`;
  try { appendFileSync(OPENAI_LOG, line); } catch {}
}
