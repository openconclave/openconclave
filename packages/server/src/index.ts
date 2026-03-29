import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { workflowRoutes } from "./routes/workflows";
import { runRoutes } from "./routes/runs";
import { agentRoutes } from "./routes/agents";
import { wsHandler } from "./ws/handler";
import { createMcpServer } from "./mcp/server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { WorkflowExecutor } from "./engine/executor";
import { CronScheduler } from "./engine/scheduler";
import { agentPool } from "./agent/pool";
import { checkOllama } from "./agent/ollama";
import { TelegramTrigger } from "./triggers/telegram";
import { db } from "./db/client";
import { workflows, runs, agentTasks, settings } from "./db/schema";
import { sql, eq } from "drizzle-orm";

// Auto-create tables on first run
db.run(sql`CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

db.run(sql`CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  status TEXT NOT NULL,
  trigger_type TEXT,
  trigger_payload TEXT,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
)`);

db.run(sql`CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  system_prompt TEXT,
  model TEXT DEFAULT 'sonnet',
  input TEXT,
  output TEXT,
  error TEXT,
  tokens_used INTEGER,
  cost_usd REAL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
)`);

db.run(sql`CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_id TEXT,
  type TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL
)`);

db.run(sql`CREATE TABLE IF NOT EXISTS mcp_servers (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
)`);

db.run(sql`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/dashboard", async (c) => {
  const allWorkflows = await db.select().from(workflows);
  const allRuns = await db.select().from(runs);
  const allTasks = await db.select().from(agentTasks);
  return c.json({
    totalWorkflows: allWorkflows.length,
    activeRuns: allRuns.filter((r) => r.status === "running").length,
    recentRuns: allRuns.slice(0, 20),
    agentTasks: allTasks.slice(0, 20),
  });
});

// Settings API
app.get("/api/settings", async (c) => {
  const all = await db.select().from(settings);
  const obj: Record<string, string> = {};
  for (const s of all) obj[s.key] = s.value;
  return c.json(obj);
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json() as Record<string, string>;
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(body)) {
    await db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
  }
  return c.json({ ok: true });
});

app.get("/api/ollama/status", async (c) => {
  const status = await checkOllama();
  return c.json(status);
});

app.route("/api/workflows", workflowRoutes);
app.route("/api/runs", runRoutes);
app.route("/api/agents", agentRoutes);

// Workflow execution — trigger a run
let _server: ReturnType<typeof Bun.serve>;

const executor = new WorkflowExecutor((event) => {
  // Publish events to WebSocket subscribers
  if (_server) {
    _server.publish(`run:${event.runId}`, JSON.stringify(event));
    _server.publish("dashboard", JSON.stringify(event));
  }
});

app.post("/api/workflows/:id/run", async (c) => {
  const { id } = c.req.param();
  const wf = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!wf.length) return c.json({ error: "Workflow not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const definition = wf[0].definition as any;

  // Find the first trigger node to use as entry point
  const triggerNode = (definition.nodes ?? []).find(
    (n: any) => n.data?.type === "trigger"
  );
  const runId = await executor.execute(definition, body.payload, triggerNode?.id);

  return c.json({ runId, status: "running" }, 201);
});

app.get("/api/agents/pool", (c) => {
  return c.json(agentPool.stats);
});

// MCP over SSE — lets external clients connect via HTTP
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

// Telegram trigger — called when a Telegram message arrives
app.post("/api/triggers/telegram", async (c) => {
  const body = await c.req.json() as { chatId: string; message: string };
  const allWorkflows = await db.select().from(workflows);

  const triggered: string[] = [];
  for (const wf of allWorkflows) {
    if (!wf.enabled) continue;
    const def = wf.definition as any;
    for (const node of def.nodes ?? []) {
      if (node.data?.type === "trigger" && node.data?.config?.type === "telegram") {
        const triggerChatId = node.data.config.chatId;
        if (triggerChatId === body.chatId || !triggerChatId) {
          const runId = await executor.execute(def, body.message);
          triggered.push(runId);
        }
      }
    }
  }

  return c.json({ triggered });
});

_server = Bun.serve({
  port: 4000,
  fetch(req, server) {
    if (server.upgrade(req, { data: { topics: new Set() } })) {
      return;
    }
    return app.fetch(req);
  },
  websocket: wsHandler,
});

app.get("/api/scheduler", (c) => {
  return c.json({ schedule: scheduler.getSchedule() });
});

app.post("/api/scheduler/sync", async (c) => {
  await scheduler.sync();
  return c.json({ schedule: scheduler.getSchedule() });
});

console.log(`🔮 OpenConclave server running at http://localhost:${_server.port}`);

// Start cron scheduler
const scheduler = new CronScheduler(executor);
scheduler.start();

// Start Telegram trigger polling
const telegramTrigger = new TelegramTrigger(executor);
telegramTrigger.start();

app.post("/api/telegram/restart", async (c) => {
  await telegramTrigger.restart();
  return c.json({ ok: true });
});
