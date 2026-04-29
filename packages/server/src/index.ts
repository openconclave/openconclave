import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { eq, and, inArray } from "drizzle-orm";
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { join, dirname, basename } from "path";
import { WORKSPACE } from "./lib/workspace";

import { logger } from "./lib/logger";
import { errorHandler } from "./lib/errors";
import { getAsset, hasEmbeddedAssets } from "./embedded-assets";
import { db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { recoverStaleRuns } from "./engine/recovery";
import { conclaves, runs, runEvents } from "./db/schema";
import { conclaveRoutes } from "./routes/conclaves";
import { runRoutes } from "./routes/runs";
import { agentRoutes } from "./routes/agents";
import { knowledgeRoutes } from "./routes/knowledge";
import { mcpRegistryRoutes } from "./routes/mcp-registry";
import { settingsRoutes, providerRoutes, ollamaRoutes, claudeCodeRoutes } from "./routes/settings";
import { webSearchRoutes } from "./routes/web-search";
import { channelRoutes } from "./routes/channel";
import { createDashboardRoutes } from "./routes/dashboard";
import { promptRoutes } from "./routes/prompts";
import { updateRoutes } from "./routes/update";
import { startUpdateChecker } from "./update/check";
import { cleanupOldBinary } from "./update/install";
import { marketplaceRoutes } from "./routes/marketplace";
import { wsHandler } from "./ws/handler";
import { setServer, broadcastRunEvent } from "./ws/broadcast";
import { createMcpServer } from "./mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ConclaveExecutor } from "./engine/executor";
import { getRunWorkspace } from "./engine/graph-walker";
import { CronScheduler } from "./engine/scheduler";
import { agentPool } from "./agent/pool";
import { listArtifacts } from "./agent/artifact-tools";
import { sessionDirForRun } from "./lib/workspace";
import { TelegramTrigger } from "./triggers/telegram";
import { AppError, ErrorCode } from "@openconclave/shared";
import { API_PORT, VERSION } from "@openconclave/shared";

// ── Database ─────────────────────────────────────────────────
runMigrations();
await recoverStaleRuns();

// ── App ──────────────────────────────────────────────────────
const app = new Hono();

app.use("*", cors({
  origin: (origin: string) => {
    if (!origin) return undefined;
    // Loopback origins on any port are trusted (dev UI, the OC server itself
    // when running on a non-default port). Cross-origin browser requests with
    // a non-loopback Origin are rejected. This keeps the loopback-only
    // posture intact while supporting OC_PORT / port-fallback installs.
    const m = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.exec(origin);
    return m ? origin : null;
  },
  credentials: false,
}));
app.onError(errorHandler);

// ── Health ───────────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ status: "ok", version: VERSION }));

// ── Routes ───────────────────────────────────────────────────
app.route("/api/settings", settingsRoutes);
app.route("/api/settings/web-search", webSearchRoutes);
app.route("/api/providers", providerRoutes);
app.route("/api/ollama", ollamaRoutes);
app.route("/api/claude-code", claudeCodeRoutes);
app.route("/api/channel", channelRoutes);
app.route("/api/conclaves", conclaveRoutes);
app.route("/api/runs", runRoutes);
app.route("/api/agents", agentRoutes);
app.route("/api/knowledge", knowledgeRoutes);
app.route("/api/mcp-registry", mcpRegistryRoutes);
app.route("/api/prompts", promptRoutes);
app.route("/api/update", updateRoutes);
app.route("/api/starters", marketplaceRoutes);

// ── Executor ─────────────────────────────────────────────────
let server: ReturnType<typeof Bun.serve>;

// Late-bound reference — set after TelegramTrigger is created below
let telegramTrigger: InstanceType<typeof TelegramTrigger> | null = null;

const executor = new ConclaveExecutor((event) => {
  broadcastRunEvent(event);
  telegramTrigger?.onEvent(event);
});

// ── Conclave Run Trigger ─────────────────────────────────────
app.post("/api/conclaves/:id/run", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) throw AppError.validation("Invalid conclave ID");
  const wf = await db.select().from(conclaves).where(eq(conclaves.id, id));
  if (!wf[0]) throw AppError.notFound("Conclave", String(id));

  const rawBody = await c.req.text();
  let body: Record<string, unknown> = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw AppError.validation("Invalid JSON in request body");
    }
  }

  const definition = wf[0].definition as Record<string, unknown>;
  const nodes = (definition.nodes ?? []) as Array<{ id: string; data?: { type?: string } }>;
  const triggerNode = nodes.find((n) => n.data?.type === "trigger");

  const attachments = body.attachments as Array<{ filename: string; contentBase64: string }> | undefined;

  const runId = await executor.execute(
    definition as never,
    body.payload,
    triggerNode?.id,
    attachments
  );

  return c.json({ runId, status: "running" }, 201);
});

// ── Resume Failed / Interrupted Run ─────────────────────────
app.post("/api/runs/:id/resume", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) throw AppError.validation("Invalid run ID");

  const updated = await db
    .update(runs)
    .set({ status: "running", startedAt: new Date().toISOString(), completedAt: null, error: null })
    .where(and(eq(runs.id, id), inArray(runs.status, ["failure", "interrupted", "cancelled"])))
    .returning({ id: runs.id, conclaveId: runs.conclaveId });

  if (updated.length === 0) {
    const run = await db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) throw AppError.notFound("Run", String(id));
    return c.json(
      { error: { code: "CONFLICT", message: `Run ${id} is not resumable (status: ${run.status})` } },
      409
    );
  }

  const updatedRow = updated[0]!;
  const wf = await db
    .select()
    .from(conclaves)
    .where(eq(conclaves.id, updatedRow.conclaveId))
    .get();
  if (!wf) throw AppError.notFound("Conclave", String(updatedRow.conclaveId));

  await executor.resume(id, wf.definition as never);
  return c.json({ resumed: true, runId: id }, 200);
});

// ── Chat Message (continue existing run) ─────────────────────
app.post("/api/runs/:runId/message", async (c) => {
  const runId = Number(c.req.param("runId"));
  if (isNaN(runId)) throw AppError.validation("Invalid run ID");

  const run = await db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) throw AppError.notFound("Run", String(runId));

  const wf = await db.select().from(conclaves).where(eq(conclaves.id, run.conclaveId)).get();
  if (!wf) throw AppError.notFound("Conclave", String(run.conclaveId));

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    throw AppError.validation("Invalid JSON in request body");
  }

  const message = body.message;
  if (typeof message !== "string" || !message.trim()) {
    throw AppError.validation("message is required and must be a non-empty string");
  }

  const definition = wf.definition as Record<string, unknown>;
  const nodes = (definition.nodes ?? []) as Array<{ id: string; data?: { type?: string } }>;
  const triggerNode = nodes.find((n) => n.data?.type === "trigger");

  const now = new Date().toISOString();
  await db.insert(runEvents).values({
    runId,
    nodeId: triggerNode?.id ?? null,
    type: "chat:userMessage",
    data: { content: message },
    createdAt: now,
  });
  broadcastRunEvent({
    type: "chat:userMessage",
    runId,
    nodeId: triggerNode?.id,
    data: { content: message },
  });

  const attachments = body.attachments as Array<{ filename: string; contentBase64: string }> | undefined;

  await executor.executeInRun(
    runId,
    definition as never,
    message,
    triggerNode?.id,
    attachments
  );

  return c.json({ runId, status: "running" });
});

// ── Artifacts ─────────────────────────────────────────────────
app.get("/api/runs/:runId/artifacts", (c) => {
  const runId = Number(c.req.param("runId"));
  if (isNaN(runId)) throw AppError.validation("Invalid run ID");
  const artifacts = listArtifacts(runId);
  const dir = join(sessionDirForRun(runId), "artifacts");
  return c.json({ data: { artifacts, dir } });
});

app.post("/api/runs/:runId/artifacts/:filename/reveal", async (c) => {
  const runId = Number(c.req.param("runId"));
  if (isNaN(runId)) throw AppError.validation("Invalid run ID");
  const raw = c.req.param("filename");
  const safe = basename(raw);
  if (safe !== raw || safe.includes("..") || safe.length === 0) {
    throw AppError.validation("Invalid filename");
  }
  const path = join(sessionDirForRun(runId), "artifacts", safe);
  if (!existsSync(path)) throw AppError.notFound("Artifact", safe);

  try {
    if (process.platform === "win32") {
      Bun.spawn(["explorer", `/select,${path}`]);
    } else if (process.platform === "darwin") {
      Bun.spawn(["open", "-R", path]);
    } else {
      Bun.spawn(["xdg-open", dirname(path)]);
    }
  } catch (err: unknown) {
    logger.warn("reveal failed", { error: err instanceof Error ? err.message : String(err) });
  }
  return c.body(null, 204);
});

// ── Set working directory for a running conclave ─────────────
app.post("/api/runs/:runId/cwd", async (c) => {
  const runId = Number(c.req.param("runId"));
  if (isNaN(runId)) throw AppError.validation("Invalid run ID");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    throw AppError.validation("Invalid JSON in request body");
  }

  const cwd = body.cwd as string | undefined;
  const nodeId = body.nodeId as string | undefined;

  if (!cwd || typeof cwd !== "string") {
    throw AppError.validation("cwd is required");
  }
  if (!nodeId || typeof nodeId !== "string") {
    throw AppError.validation("nodeId is required");
  }

  const run = await db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) throw AppError.notFound("Run", String(runId));
  const wf = await db.select().from(conclaves).where(eq(conclaves.id, run.conclaveId)).get();
  if (!wf) throw AppError.notFound("Conclave", String(run.conclaveId));
  const def = wf.definition as { nodes?: Array<{ id: string; data?: { type?: string } }> };
  const callingNode = (def.nodes ?? []).find((n) => n.id === nodeId);
  if (!callingNode || callingNode.data?.type !== "code") {
    throw new AppError(ErrorCode.UNAUTHORIZED, "Only code nodes can set the working directory", 403);
  }

  const workspace = getRunWorkspace(runId);
  if (!workspace) throw AppError.notFound("Workspace", String(runId));

  workspace.setCwd(cwd);
  return c.json({ ok: true, cwd: workspace.cwd });
});

// ── Conclave by toolName (for chat UI) ──────────────────────
app.get("/api/conclaves/by-tool/:toolName", async (c) => {
  const { toolName } = c.req.param();
  const all = await db.select().from(conclaves);
  const match = all.find((w) => {
    const def = w.definition as Record<string, unknown>;
    return def.toolName === toolName;
  });
  if (!match) throw AppError.notFound("Conclave", toolName);
  return c.json({ conclave: match });
});

app.get("/api/agents/pool", (c) => c.json(agentPool.stats));

// ── Telegram Trigger API ─────────────────────────────────────
app.post("/api/triggers/telegram", async (c) => {
  const rawBody = await c.req.json() as Record<string, unknown>;
  if (typeof rawBody.chatId !== "string" || typeof rawBody.message !== "string") {
    throw AppError.validation("chatId and message are required strings");
  }
  const body = rawBody as { chatId: string; message: string };
  const allConclaves = await db.select().from(conclaves);

  const triggered: number[] = [];
  for (const wf of allConclaves) {
    if (!wf.enabled) continue;
    const def = wf.definition as Record<string, unknown>;
    const nodes = (def.nodes ?? []) as Array<{
      id: string;
      data?: { type?: string; config?: { type?: string; chatId?: string } };
    }>;

    for (const node of nodes) {
      if (node.data?.type === "trigger" && node.data?.config?.type === "telegram") {
        const triggerChatId = node.data.config.chatId;
        if (triggerChatId === body.chatId || !triggerChatId) {
          logger.info(`Triggering conclave "${wf.name}" from Telegram`, { chatId: body.chatId });
          const runId = await executor.execute(def as never, body.message, node.id);
          triggered.push(runId);
        }
      }
    }
  }

  return c.json({ triggered });
});

// ── MCP stdio client tracking (auto-shutdown daemon) ────────
// Plugin mode: every CC session's stdio MCP child registers its PID here on
// startup and drops it on transport close. When the last client disconnects
// we shut ourselves down after a short grace window (so /reload-plugins'
// rapid restart doesn't cycle the server). In standalone mode (no
// OC_PLUGIN_ROOT) the server stays up regardless — registrations are
// tracked but never trigger shutdown.
const mcpClientPids = new Set<number>();
const AUTO_SHUTDOWN = Boolean(process.env.OC_PLUGIN_ROOT);
const SHUTDOWN_GRACE_MS = 5000;
let hasEverRegistered = false;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

function cancelShutdownTimer(): void {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

function maybeScheduleShutdown(): void {
  if (!AUTO_SHUTDOWN || !hasEverRegistered) return;
  if (mcpClientPids.size > 0) return;
  cancelShutdownTimer();
  shutdownTimer = setTimeout(() => {
    if (mcpClientPids.size === 0) {
      logger.info("No MCP clients remain; shutting down.");
      shutdown();
    }
  }, SHUTDOWN_GRACE_MS);
}

app.post("/api/mcp-sessions", async (c) => {
  let body: { pid?: number };
  try {
    body = await c.req.json() as { pid?: number };
  } catch {
    throw AppError.validation("Invalid JSON in request body");
  }
  const pid = Number(body.pid);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw AppError.validation("pid is required and must be a positive integer");
  }
  mcpClientPids.add(pid);
  hasEverRegistered = true;
  cancelShutdownTimer();
  return c.json({ ok: true, active: mcpClientPids.size });
});

app.delete("/api/mcp-sessions/:pid", (c) => {
  const pid = Number(c.req.param("pid"));
  if (Number.isFinite(pid)) mcpClientPids.delete(pid);
  maybeScheduleShutdown();
  return c.json({ ok: true, active: mcpClientPids.size });
});

// Belt-and-suspenders: reap PIDs whose processes have vanished (crash case,
// onclose never fired). process.kill(pid, 0) is a probe — it throws iff the
// PID is gone. Cheap, runs every 30s, no-op in quiescent state.
setInterval(() => {
  let reaped = 0;
  for (const pid of mcpClientPids) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        mcpClientPids.delete(pid);
        reaped++;
      }
    }
  }
  if (reaped > 0) maybeScheduleShutdown();
}, 30000).unref();

// ── MCP over Streamable HTTP ────────────────────────────────
const mcpTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();

app.all("/mcp", async (c) => {
  const sessionId = c.req.header("mcp-session-id");
  let transport = sessionId ? mcpTransports.get(sessionId) : undefined;

  if (sessionId && !transport) {
    return c.json({ error: { code: "NOT_FOUND", message: "Unknown session" } }, 404);
  }

  if (!transport) {
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => { mcpTransports.set(id, transport!); },
      onsessionclosed: (id) => { mcpTransports.delete(id); },
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
  }

  const response = await transport.handleRequest(c.req.raw);
  return response;
});

// ── Server ───────────────────────────────────────────────────
// Port selection order:
//   1. OC_PORT env var (operator-set, highest priority)
//   2. PORT env var (legacy)
//   3. API_PORT default (4000), then sequential fallback 4001..4009
//   4. Port 0 (OS-assigned random) as last resort
// Lets corporate firewalls or port-conflict installs work without config.
function buildPortCandidates(): number[] {
  const out: number[] = [];
  for (const env of [process.env.OC_PORT, process.env.PORT]) {
    const n = Number(env);
    if (env && Number.isFinite(n) && n > 0 && n < 65536 && !out.includes(n)) out.push(n);
  }
  if (!out.length) {
    for (let p = API_PORT; p < API_PORT + 10; p++) out.push(p);
  }
  out.push(0);
  return out;
}

// Discovery file: the chosen port lives at WORKSPACE/port so the plugin
// monitor, MCP shim, and any external tooling can read it without
// scanning the network. Atomic write: write-then-rename avoids torn reads.
const PORT_FILE = join(WORKSPACE, "port");

// PID file for the Claude Code plugin monitor: lets a new session detect
// whether the previous session's server is still alive before trying to
// bind. Stale files (process already gone) are cleaned up by the
// plugin-server.sh startup check.
const PID_FILE = join(WORKSPACE, "oc.pid");

function checkPidfileConflict(): void {
  if (!existsSync(PID_FILE)) return;
  try {
    const raw = readFileSync(PID_FILE, "utf-8").trim();
    const priorPid = Number(raw);
    if (!Number.isFinite(priorPid) || priorPid <= 0) {
      unlinkSync(PID_FILE);
      return;
    }
    // kill(pid, 0) returns true if the process exists and is reachable.
    try {
      process.kill(priorPid, 0);
      // Another instance is alive. Don't overwrite its pidfile; fail fast.
      logger.error(`Another OC server already runs (pid=${priorPid}). Exiting.`);
      process.exit(1);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        // EPERM means process is alive but unreachable — treat as conflict.
        logger.error(`Another OC server may still be running (pid=${priorPid}). Exiting.`);
        process.exit(1);
      }
      unlinkSync(PID_FILE);
    }
  } catch (err) {
    logger.warn("pidfile check failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

checkPidfileConflict();

const candidates = buildPortCandidates();
let lastErr: unknown;
for (const candidate of candidates) {
  try {
    server = Bun.serve({
      port: candidate,
      hostname: "127.0.0.1",
      idleTimeout: 120,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: { topics: new Set() } })) {
          return;
        }
        return app.fetch(req);
      },
      websocket: wsHandler,
    });
    break;
  } catch (err) {
    lastErr = err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EADDRINUSE" && code !== "EACCES") throw err;
    logger.debug(`port ${candidate} unavailable (${code}), trying next`);
  }
}
if (!server!) {
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`No usable port (last error: ${msg})`);
}
const port = server.port;
setServer(server);
writeFileSync(PID_FILE, String(process.pid), "utf-8");
// Discovery file: write-then-rename so external readers never see a torn file.
const portTmp = PORT_FILE + ".tmp";
writeFileSync(portTmp, String(port), "utf-8");
renameSync(portTmp, PORT_FILE);

// ── Scheduler ────────────────────────────────────────────────
const scheduler = new CronScheduler(executor);
scheduler.start();

app.route("/api/dashboard", createDashboardRoutes(scheduler));
app.get("/api/scheduler", (c) => c.json({ schedule: scheduler.getSchedule() }));

app.post("/api/scheduler/sync", async (c) => {
  await scheduler.sync();
  return c.json({ schedule: scheduler.getSchedule() });
});

// ── Update Checker ───────────────────────────────────────────
void cleanupOldBinary();
startUpdateChecker();

// ── Telegram Trigger ─────────────────────────────────────────
telegramTrigger = new TelegramTrigger(executor);
void telegramTrigger.start().catch((err: Error) => logger.error("telegram start failed", { error: err.message }));

app.post("/api/telegram/restart", async (c) => {
  await telegramTrigger.restart();
  return c.json({ ok: true });
});

// ── Static Files (production/compiled mode) ─────────────────
// Must be registered AFTER all API routes so the catch-all doesn't shadow them.
// Supports three modes: embedded assets (single binary), external public/
// folder (installed binary), or a built client/dist/ (plugin/source runs).
const publicDir = process.env.OC_PUBLIC_DIR
  ?? (existsSync(join(dirname(process.execPath), "public"))
    ? join(dirname(process.execPath), "public")
    : join(import.meta.dir, "..", "..", "client", "dist"));
if (hasEmbeddedAssets) {
  logger.debug("Serving embedded client assets");
  app.get("*", (c) => {
    const path = c.req.path;
    if (path.startsWith("/api") || path.startsWith("/mcp") || path.startsWith("/ws")) {
      return c.notFound();
    }
    const asset = getAsset(path) ?? getAsset("/index.html");
    if (!asset) return c.notFound();
    return c.body(asset.body.buffer as ArrayBuffer, { headers: { "Content-Type": asset.type } });
  });
} else if (existsSync(publicDir)) {
  logger.debug(`Serving static files from ${publicDir}`);
  app.use("*", serveStatic({ root: publicDir, rewriteRequestPath: (p) => p }));
  app.get("*", (c) => {
    const path = c.req.path;
    if (path.startsWith("/api") || path.startsWith("/mcp") || path.startsWith("/ws")) {
      return c.notFound();
    }
    if (!existsSync(join(publicDir, "index.html"))) return c.notFound();
    return c.body(Bun.file(join(publicDir, "index.html")).stream(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}

// ── Graceful Shutdown ────────────────────────────────────────
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down...");
  scheduler.stop();
  telegramTrigger?.stop();
  server.stop();
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch { }
  try { if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE); } catch { }
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
  shutdown();
});
process.on("exit", () => {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch { }
  try { if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE); } catch { }
});

// ── Ready ────────────────────────────────────────────────────
const a = "\x1b[38;5;214m";
const r = "\x1b[0m";
const d = "\x1b[2m";

console.log(`
  ${a}◆${r}  O P E N C O N C L A V E  ${d}v${VERSION}${r}

  ${d}Open:${r}  ${a}http://localhost:${port}${r}
`);
