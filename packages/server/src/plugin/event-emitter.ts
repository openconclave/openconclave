import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { RunEvent } from "../engine/types";
import { logger } from "../lib/logger";

const EVENT_PREFIX = "__OC_EVENT__";
const PLUGIN_EVENT_TYPES = new Set<string>([
  "channel:output",
  "prompt:question",
]);

let counter = 0;

// When Claude Code exits on Windows, the plugin monitor closes its end of
// our stdout pipe but the server (an orphaned bun process) keeps running.
// The next process.stdout.write() then throws EPIPE and crashes the server.
// Install a one-time error handler that swallows EPIPE so the rest of the
// server keeps serving MCP/HTTP — just without a notification channel.
let stdoutAlive = true;
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED") {
    stdoutAlive = false;
    return;
  }
  // Real error — re-throw via logger so it lands in server.log instead of
  // killing the process.
  logger.warn("stdout error", { error: err.message, code: err.code });
});

function nextEventId(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

function eventDir(runId: number): string {
  const data = process.env.OC_DATA_DIR || join(homedir(), ".openconclave");
  const dir = join(data, "sessions", String(runId), "events");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function isPluginMode(): boolean {
  return Boolean(process.env.OC_PLUGIN_ROOT);
}

/**
 * When the server is running inside a Claude Code plugin, mirror interesting
 * run events to disk and emit a compact stdout notification pointing at the
 * file. Claude reads the notification (as a monitor event), opens the file for
 * full payload, and — for prompt questions — answers via the respond_to_prompt
 * MCP tool.
 *
 * The WS broadcast path is unchanged; this is an additive sink.
 */
export function maybeEmitPluginEvent(event: RunEvent): void {
  if (!isPluginMode()) return;
  if (!PLUGIN_EVENT_TYPES.has(event.type)) return;

  try {
    const id = nextEventId();
    const dir = eventDir(event.runId);
    const filePath = join(dir, `${id}-${event.type.replace(":", "_")}.json`);
    writeFileSync(filePath, JSON.stringify(event, null, 2), "utf-8");

    if (!stdoutAlive) return; // Monitor pipe already dead; file is still on disk.

    const notification = {
      event: event.type,
      run_id: event.runId,
      node_id: event.nodeId,
      file: filePath,
      ...(event.type === "prompt:question"
        ? {
            hint: `Read the file, decide a response, then call respond_to_prompt(runId=${event.runId}, nodeId="${event.nodeId}", response=...) to unblock the run.`,
          }
        : {}),
    };

    try {
      process.stdout.write(`${EVENT_PREFIX} ${JSON.stringify(notification)}\n`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
        stdoutAlive = false;
      } else {
        throw err;
      }
    }
  } catch (err) {
    logger.warn("plugin event emit failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
