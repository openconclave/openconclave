import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, desc, and, inArray } from "drizzle-orm";

import { logger } from "./lib/logger";
import { errorHandler } from "./lib/errors";
import { db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { recoverStaleRuns } from "./engine/recovery";
import { workflows, runs, agentTasks, runEvents, settings } from "./db/schema";
import { respondToPrompt, getPendingPrompts } from "./engine/prompt-registry";
import { workflowRoutes } from "./routes/workflows";
import { runRoutes } from "./routes/runs";
import { agentRoutes } from "./routes/agents";
import { knowledgeRoutes } from "./routes/knowledge";
import { mcpRegistryRoutes } from "./routes/mcp-registry";
import { wsHandler } from "./ws/handler";
import { setServer, broadcastRunEvent, broadcastToTopic } from "./ws/broadcast";
import { createMcpServer } from "./mcp/server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { WorkflowExecutor } from "./engine/executor";
import { CronScheduler } from "./engine/scheduler";
import { agentPool } from "./agent/pool";
import { checkOllama } from "./agent/ollama";
import { TelegramTrigger } from "./triggers/telegram";
import { AppError } from "@openconclave/shared";
import { API_PORT } from "@openconclave/shared";

// ── Database ─────────────────────────────────────────────────
runMigrations();
await recoverStaleRuns();

// ── App ──────────────────────────────────────────────────────
const app = new Hono();

app.use("*", cors());
app.use("*", errorHandler);

// ── Health ───────────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// ── Settings ─────────────────────────────────────────────────
app.get("/api/settings", async (c) => {
  const all = await db.select().from(settings);
  const obj: Record<string, string> = {};
  for (const s of all) obj[s.key] = s.value;
  return c.json(obj);
});

app.put("/api/settings", async (c) => {
  const body = (await c.req.json()) as Record<string, string>;
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(body)) {
    await db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
  }
  return c.json({ ok: true });
});

// ── Providers (OpenAI-compatible) ────────────────────────────
app.get("/api/providers", async (c) => {
  const all = await db.select().from(settings);
  const providers = all
    .filter((s) => s.key.startsWith("provider:"))
    .map((s) => {
      const p = JSON.parse(s.value);
      return { ...p, apiKey: p.apiKey ? "***" : "" }; // mask API key
    });
  return c.json({ providers });
});

app.post("/api/providers", async (c) => {
  const body = await c.req.json();
  const { id, name, baseUrl, apiKey, apiType, supportsModelList } = body;
  if (!id || !name || !baseUrl) {
    return c.json({ error: { code: "VALIDATION", message: "id, name, baseUrl required" } }, 400);
  }
  // On edit, keep existing API key if not provided
  let finalApiKey = apiKey;
  if (!finalApiKey) {
    const existing = await db.select().from(settings).where(eq(settings.key, `provider:${id}`)).get();
    if (existing) {
      finalApiKey = JSON.parse(existing.value).apiKey;
    } else {
      return c.json({ error: { code: "VALIDATION", message: "apiKey required for new providers" } }, 400);
    }
  }
  const now = new Date().toISOString();
  const provider = { id, name, baseUrl: baseUrl.replace(/\/$/, ""), apiKey: finalApiKey, apiType: apiType ?? "chat", supportsModelList: supportsModelList ?? false };
  await db
    .insert(settings)
    .values({ key: `provider:${id}`, value: JSON.stringify(provider), updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(provider), updatedAt: now } });
  return c.json({ provider: { ...provider, apiKey: "***" } });
});

app.delete("/api/providers/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(settings).where(eq(settings.key, `provider:${id}`));
  return c.json({ ok: true });
});

app.get("/api/providers/:id/models", async (c) => {
  const id = c.req.param("id");
  const row = await db.select().from(settings).where(eq(settings.key, `provider:${id}`)).get();
  if (!row) return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
  const provider = JSON.parse(row.value);
  const { listOpenAIModels } = await import("./agent/openai");
  const models = await listOpenAIModels(provider);
  return c.json({ models });
});

// ── Claude Code detection ────────────────────────────────────
app.get("/api/claude-code/status", async (c) => {
  try {
    const proc = Bun.spawn({ cmd: ["claude", "--version"], stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const out = await new Response(proc.stdout).text();
    const version = out.trim().split("\n")[0] ?? "";
    return c.json({ installed: true, version });
  } catch {
    return c.json({ installed: false, version: null });
  }
});

// ── Channel: Ask Claude to improve prompt ────────────────────
app.post("/api/channel/improve-prompt", async (c) => {
  const body = await c.req.json() as {
    workflowId: string;
    nodeId: string;
    nodeLabel: string;
    currentPrompt: string;
  };
  broadcastToTopic("dashboard", {
    type: "channel:improve-prompt",
    data: body,
  });
  return c.json({ ok: true });
});

app.post("/api/channel/improve-code", async (c) => {
  const body = await c.req.json() as {
    workflowId: string;
    nodeId: string;
    nodeLabel: string;
    runtime: string;
    currentCode: string;
  };
  broadcastToTopic("dashboard", {
    type: "channel:improve-code",
    data: body,
  });
  return c.json({ ok: true });
});

// ── Ollama ───────────────────────────────────────────────────
app.get("/api/ollama/status", async (c) => {
  const status = await checkOllama();
  return c.json(status);
});

// ── Dashboard ────────────────────────────────────────────────
app.get("/api/dashboard", async (c) => {
  const allWorkflows = await db.select().from(workflows);
  const allRuns = await db.select().from(runs).orderBy(desc(runs.createdAt));
  const allTasks = await db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt));

  const successCount = allRuns.filter((r) => r.status === "success").length;
  const failureCount = allRuns.filter((r) => r.status === "failure").length;
  const cancelledCount = allRuns.filter((r) => r.status === "cancelled").length;
  const totalCost = allTasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

  const recentOutputEvents = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.type, "channel:output"))
    .orderBy(desc(runEvents.createdAt))
    .limit(10);

  let schedule: unknown[] = [];
  try {
    schedule = scheduler.getSchedule();
  } catch {
    // Scheduler may not be initialized yet
  }

  return c.json({
    totalWorkflows: allWorkflows.length,
    activeRuns: allRuns.filter((r) => r.status === "running").length,
    recentRuns: allRuns.slice(0, 20),
    agentTasks: allTasks.slice(0, 20),
    successCount,
    failureCount,
    cancelledCount,
    totalRuns: allRuns.length,
    totalCost,
    workflows: allWorkflows.map((w) => {
      const def = w.definition as Record<string, unknown> | null;
      const nodes = (def?.nodes ?? []) as Array<{ data?: { type?: string; config?: unknown } }>;
      const triggerNode = nodes.find((n) => n.data?.type === "trigger");
      const triggerType = (triggerNode?.data?.config as Record<string, unknown> | undefined)?.type as string | undefined;
      return { id: w.id, name: w.name, enabled: w.enabled, toolName: def?.toolName as string | undefined, triggerType };
    }),
    recentOutputs: recentOutputEvents,
    schedule,
  });
});

// ── Routes ───────────────────────────────────────────────────
app.route("/api/workflows", workflowRoutes);
app.route("/api/runs", runRoutes);
app.route("/api/agents", agentRoutes);
app.route("/api/knowledge", knowledgeRoutes);
app.route("/api/mcp-registry", mcpRegistryRoutes);

// ── Executor ─────────────────────────────────────────────────
let server: ReturnType<typeof Bun.serve>;

// Late-bound reference — set after TelegramTrigger is created below
let telegramTrigger: InstanceType<typeof TelegramTrigger> | null = null;

const executor = new WorkflowExecutor((event) => {
  broadcastRunEvent(event);
  telegramTrigger?.onEvent(event);
});

// ── Workflow Run Trigger ─────────────────────────────────────
app.post("/api/workflows/:id/run", async (c) => {
  const id = Number(c.req.param("id"));
  const wf = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!wf[0]) throw AppError.notFound("Workflow", String(id));

  const body = await c.req.json().catch(() => ({}));
  const definition = wf[0].definition as Record<string, unknown>;
  const nodes = (definition.nodes ?? []) as Array<{ id: string; data?: { type?: string } }>;
  const triggerNode = nodes.find((n) => n.data?.type === "trigger");

  const runId = await executor.execute(
    definition as never,
    (body as Record<string, unknown>).payload,
    triggerNode?.id
  );

  return c.json({ runId, status: "running" }, 201);
});

// ── Resume Failed / Interrupted Run ─────────────────────────
app.post("/api/runs/:id/resume", async (c) => {
  const id = Number(c.req.param("id"));

  // Atomically claim this run for re-execution. SQLite serializes all writers, so exactly one
  // of N concurrent resume requests will update a row (updated.length === 1). The rest see 0
  // rows updated and receive a 409. We also clear completedAt/error so the row is clean for
  // the new attempt.
  const updated = await db
    .update(runs)
    .set({ status: "running", startedAt: new Date().toISOString(), completedAt: null, error: null })
    .where(and(eq(runs.id, id), inArray(runs.status, ["failure", "interrupted", "cancelled"])))
    .returning({ id: runs.id, workflowId: runs.workflowId });

  if (updated.length === 0) {
    // Distinguish 404 (run doesn't exist) from 409 (exists but not in a resumable state)
    const run = await db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) throw AppError.notFound("Run", String(id));
    return c.json(
      { error: { code: "CONFLICT", message: `Run ${id} is not resumable (status: ${run.status})` } },
      409
    );
  }

  const wf = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, updated[0].workflowId))
    .get();
  if (!wf) throw AppError.notFound("Workflow", String(updated[0].workflowId));

  // WARNING: resuming against a modified workflow definition may produce unexpected results
  // if nodes before the checkpoint were added, removed, or renamed since the original run.
  // Future: store workflowUpdatedAt in the checkpoint row and warn on mismatch.
  await executor.resume(id, wf.definition as never);
  return c.json({ resumed: true, runId: id }, 200);
});

// ── Chat Message (continue existing run) ─────────────────────
app.post("/api/runs/:runId/message", async (c) => {
  const runId = Number(c.req.param("runId"));
  const run = await db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) return c.json({ error: { code: "NOT_FOUND", message: "Run not found" } }, 404);

  const wf = await db.select().from(workflows).where(eq(workflows.id, run.workflowId)).get();
  if (!wf) return c.json({ error: { code: "NOT_FOUND", message: "Workflow not found" } }, 404);

  const body = await c.req.json().catch(() => ({}));
  const message = (body as Record<string, unknown>).message as string;
  const definition = wf.definition as Record<string, unknown>;
  const nodes = (definition.nodes ?? []) as Array<{ id: string; data?: { type?: string } }>;
  const triggerNode = nodes.find((n) => n.data?.type === "trigger");

  // Persist user message as a run event so chat history survives page reloads
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

  await executor.executeInRun(
    runId,
    definition as never,
    message,
    triggerNode?.id
  );

  return c.json({ runId, status: "running" });
});

// ── Workflow by toolName (for chat UI) ──────────────────────
app.get("/api/workflows/by-tool/:toolName", async (c) => {
  const { toolName } = c.req.param();
  const all = await db.select().from(workflows);
  const match = all.find((w) => {
    const def = w.definition as Record<string, unknown>;
    return def.toolName === toolName;
  });
  if (!match) return c.json({ error: { code: "NOT_FOUND", message: `No workflow with toolName "${toolName}"` } }, 404);
  return c.json({ workflow: match });
});

app.get("/api/agents/pool", (c) => c.json(agentPool.stats));

// ── Prompt (Human/Claude-in-the-loop) ────────────────────────
app.get("/api/prompts/pending", (c) => {
  return c.json({ prompts: getPendingPrompts() });
});

app.post("/api/prompts/respond", async (c) => {
  const body = (await c.req.json()) as { runId: number; nodeId: string; response: string };
  const ok = respondToPrompt(body.runId, body.nodeId, body.response);
  if (!ok) return c.json({ error: "No pending prompt found" }, 404);
  return c.json({ ok: true });
});

// ── Telegram Trigger API ─────────────────────────────────────
app.post("/api/triggers/telegram", async (c) => {
  const body = (await c.req.json()) as { chatId: string; message: string };
  const allWorkflows = await db.select().from(workflows);

  const triggered: string[] = [];
  for (const wf of allWorkflows) {
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
          logger.info(`Triggering workflow "${wf.name}" from Telegram`, { chatId: body.chatId });
          const runId = await executor.execute(def as never, body.message, node.id);
          triggered.push(runId);
        }
      }
    }
  }

  return c.json({ triggered });
});

// ── MCP over SSE ─────────────────────────────────────────────
const mcpTransports = new Map<string, SSEServerTransport>();

app.get("/mcp/sse", async (c) => {
  const mcpServer = createMcpServer();
  const transport = new SSEServerTransport("/mcp/messages", c.res);
  mcpTransports.set(transport.sessionId, transport);
  c.res.on?.("close", () => mcpTransports.delete(transport.sessionId));
  await mcpServer.connect(transport);
  return c.res;
});

app.post("/mcp/messages", async (c) => {
  const sessionId = new URL(c.req.url).searchParams.get("sessionId");
  const transport = sessionId ? mcpTransports.get(sessionId) : undefined;
  if (!transport) return c.json({ error: "Session not found" }, 404);
  const body = await c.req.json();
  await transport.handlePostMessage(body);
  return c.json({ ok: true });
});

// ── Server ───────────────────────────────────────────────────
const port = Number(process.env.PORT ?? API_PORT);

server = Bun.serve({
  port,
  idleTimeout: 120, // seconds — default 10s is too short for external registry fetches
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

// ── Ready ────────────────────────────────────────────────────
logger.info(`OpenConclave server running at http://localhost:${port}`);
