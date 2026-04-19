import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { eq, and, inArray } from "drizzle-orm";
import { existsSync } from "fs";
import { join, dirname } from "path";

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
import { AppError } from "@openconclave/shared";
import { API_PORT, VERSION } from "@openconclave/shared";

// ── Database ─────────────────────────────────────────────────
runMigrations();
await recoverStaleRuns();

// ── App ──────────────────────────────────────────────────────
const app = new Hono();

app.use("*", cors());
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

  // Body is optional — an empty body means no payload. Malformed JSON is rejected.
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
  const { basename } = await import("path");
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
    return c.json({ error: { code: "BAD_REQUEST", message: "cwd is required" } }, 400);
  }

  if (nodeId) {
    const run = await db.select().from(runs).where(eq(runs.id, runId)).get();
    if (run) {
      const wf = await db.select().from(conclaves).where(eq(conclaves.id, run.conclaveId)).get();
      if (wf) {
        const def = wf.definition as { nodes?: Array<{ id: string; data?: { type?: string } }> };
        const callingNode = (def.nodes ?? []).find((n) => n.id === nodeId);
        if (!callingNode || callingNode.data?.type !== "code") {
          return c.json({ error: { code: "FORBIDDEN", message: "Only code nodes can set the working directory" } }, 403);
        }
      }
    }
  }

  const workspace = getRunWorkspace(runId);
  if (!workspace) {
    return c.json({ error: { code: "NOT_FOUND", message: "No active workspace for this run" } }, 404);
  }

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
  if (!match) return c.json({ error: { code: "NOT_FOUND", message: `No conclave with toolName "${toolName}"` } }, 404);
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

// ── MCP over Streamable HTTP ────────────────────────────────
const mcpTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();

app.all("/mcp", async (c) => {
  // Each session gets its own transport + server instance
  const sessionId = c.req.header("mcp-session-id");
  let transport = sessionId ? mcpTransports.get(sessionId) : undefined;

  if (!transport) {
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => { mcpTransports.set(id, transport!); },
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
  }

  const response = await transport.handleRequest(c.req.raw);
  return response;
});

// ── Server ───────────────────────────────────────────────────
const port = Number(process.env.PORT ?? API_PORT);

server = Bun.serve({
  port,
  idleTimeout: 120,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: { topics: new Set() } })) {
      return;
    }
    return app.fetch(req);
  },
  websocket: wsHandler,
});
setServer(server);

// ── Scheduler ────────────────────────────────────────────────
const scheduler = new CronScheduler(executor);
scheduler.start();

app.route("/api/dashboard", createDashboardRoutes(scheduler));
app.get("/api/scheduler", (c) => c.json({ schedule: scheduler.getSchedule() }));

app.post("/api/scheduler/sync", async (c) => {
  await scheduler.sync();
  return c.json({ schedule: scheduler.getSchedule() });
});

// ── Telegram Trigger ─────────────────────────────────────────
telegramTrigger = new TelegramTrigger(executor);
telegramTrigger.start();

app.post("/api/telegram/restart", async (c) => {
  await telegramTrigger.restart();
  return c.json({ ok: true });
});

// ── Static Files (production/compiled mode) ─────────────────
// Must be registered AFTER all API routes so the catch-all doesn't shadow them.
// Supports two modes: embedded assets (single binary) or external public/ folder.
const publicDir = join(dirname(process.execPath), "public");
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
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Ready ────────────────────────────────────────────────────
const a = "\x1b[38;5;214m";
const r = "\x1b[0m";
const d = "\x1b[2m";

console.log(`
  ${a}◆${r}  O P E N C O N C L A V E  ${d}v${VERSION}${r}

  ${d}Open:${r}  ${a}http://localhost:${port}${r}
`);
