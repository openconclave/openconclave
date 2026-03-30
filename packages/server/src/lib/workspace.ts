import { mkdirSync } from "fs";
import { join } from "path";

/**
 * All OpenConclave data lives under .openconclave/ in the project root.
 * This keeps the project directory clean and consolidates data in one place.
 */
export const WORKSPACE = join(process.cwd(), ".openconclave");
export const OUTPUTS_DIR = join(WORKSPACE, "outputs");
export const SESSIONS_DIR = join(WORKSPACE, "sessions");
export const TMP_DIR = join(WORKSPACE, "tmp");
export const DB_PATH = join(WORKSPACE, "openconclave.db");

// Ensure directories exist on import
mkdirSync(OUTPUTS_DIR, { recursive: true });
mkdirSync(SESSIONS_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });
