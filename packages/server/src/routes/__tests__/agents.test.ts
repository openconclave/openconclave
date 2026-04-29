import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { conclaves, runEvents, agentTasks } from "../../db/schema";
import { errorHandler } from "../../lib/errors";

// TEST_LIMITATION: routes/agents.ts imports a singleton db that opens the
// real on-disk database at module load; mock.module replaces it with this
// in-memory instance so the route is exercised without disk state.
const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA foreign_keys = OFF");
sqlite.exec(
  `CREATE TABLE conclaves (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
   description TEXT, definition TEXT NOT NULL, enabled INTEGER DEFAULT 1,
   created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
);
sqlite.exec(
  `CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, conclave_id INTEGER NOT NULL,
   status TEXT NOT NULL, trigger_type TEXT, trigger_payload TEXT,
   started_at TEXT, completed_at TEXT, error TEXT, created_at TEXT NOT NULL)`,
);
sqlite.exec(
  `CREATE TABLE agent_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
   node_id TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL,
   system_prompt TEXT, model TEXT DEFAULT 'sonnet', input TEXT, output TEXT,
   error TEXT, tokens_used INTEGER, cost_usd REAL,
   started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL)`,
);
sqlite.exec(
  `CREATE TABLE run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
   node_id TEXT, type TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL)`,
);

const testDb = drizzle(sqlite);

mock.module("../../db/client", () => ({ db: testDb }));
mock.module("../../ws/broadcast", () => ({ broadcastRunEvent: () => {} }));

type EmitFn = (event: { type: string; runId: number; nodeId: string; data?: unknown }) => void;

const executorState: {
  lastConfig?: Record<string, unknown>;
  lastPrompt?: string;
  emitEvents: number;
  impl?: (runId: number, nodeId: string, config: unknown, prompt: unknown, emit: EmitFn) => Promise<{ output: string }>;
} = { emitEvents: 2 };

const toolsState: {
  lastConfig?: Record<string, unknown>;
  result: { output: string; tool_call?: { name: string; input: Record<string, unknown> } };
  impl?: (opts: { config: unknown; prompt: string; runId: number; nodeId: string; emit: EmitFn }) => Promise<{ output: string; tool_call?: { name: string; input: Record<string, unknown> } }>;
} = { result: { output: "tools-output", tool_call: { name: "echo", input: { text: "hi" } } } };

mock.module("../../engine/agent-executor", () => ({
  executeAgent: async (runId: number, nodeId: string, config: unknown, prompt: unknown, emit: EmitFn) => {
    executorState.lastConfig = config as Record<string, unknown>;
    executorState.lastPrompt = String(prompt);
    if (executorState.impl) return executorState.impl(runId, nodeId, config, prompt, emit);
    for (let i = 0; i < executorState.emitEvents; i++) {
      emit({ type: "agent:output", runId, nodeId, data: { chunk: `chunk-${i}` } });
    }
    return { output: "executor-output" };
  },
}));

mock.module("../../agent/llm-call", () => ({
  invokeWithTools: async (opts: { config: unknown; prompt: string; runId: number; nodeId: string; emit: EmitFn }) => {
    toolsState.lastConfig = opts.config as Record<string, unknown>;
    if (toolsState.impl) return toolsState.impl(opts);
    opts.emit({ type: "agent:started", runId: opts.runId, nodeId: opts.nodeId, data: { taskId: 1, engine: "claude" } });
    return toolsState.result;
  },
}));

const { agentRoutes } = await import("../agents");
const app = new Hono();
app.onError(errorHandler);
app.route("/", agentRoutes);

const now = new Date().toISOString();

function clearDb() {
  sqlite.exec("DELETE FROM run_events");
  sqlite.exec("DELETE FROM agent_tasks");
  sqlite.exec("DELETE FROM runs");
  sqlite.exec("DELETE FROM conclaves");
  executorState.impl = undefined;
  executorState.emitEvents = 2;
  executorState.lastConfig = undefined;
  executorState.lastPrompt = undefined;
  toolsState.impl = undefined;
  toolsState.lastConfig = undefined;
  toolsState.result = { output: "tools-output", tool_call: { name: "echo", input: { text: "hi" } } };
}

async function insertConclave(nodeConfig: Record<string, unknown>, nodeType = "agent", nodeId = "n1"): Promise<number> {
  const definition = {
    nodes: [
      {
        id: nodeId,
        type: "default",
        position: { x: 0, y: 0 },
        data: { type: nodeType, label: nodeId, config: nodeConfig },
      },
    ],
    edges: [],
  };
  const rows = await testDb
    .insert(conclaves)
    .values({ name: "test", definition, createdAt: now, updatedAt: now })
    .returning({ id: conclaves.id });
  return rows[0]!.id;
}

// ── MAJOR: definition is JSON, not a string ────────────────────────────────

describe("POST /invoke — JSON definition (no defensive parse)", () => {
  beforeEach(clearDb);

  test("reads definition as a parsed object and resolves the node", async () => {
    const conclaveId = await insertConclave({ engine: "claude", model: "sonnet" });

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conclaveId, runId: 1, nodeId: "n1", prompt: "hi" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: string };
    expect(body.output).toBe("executor-output");
  });
});

// ── MINOR: runEvents must be persisted before the response returns ─────────

describe("POST /invoke — runEvents persistence", () => {
  beforeEach(clearDb);

  // TEST_LIMITATION: bun-sqlite's drizzle adapter executes inserts
  // synchronously, so an unawaited fire-and-forget would also have rows by
  // response time in this harness. The test still pins the persistence
  // contract: every emitted event for the run is in the DB by the time the
  // response is observed.
  test("persists every emitted event for the run before responding", async () => {
    const conclaveId = await insertConclave({ engine: "claude", model: "sonnet" });
    executorState.emitEvents = 5;

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conclaveId, runId: 42, nodeId: "n1", prompt: "hi" }),
    });
    expect(res.status).toBe(200);

    const events = await testDb.select().from(runEvents).where(eq(runEvents.runId, 42));
    expect(events).toHaveLength(5);
  });
});

// ── MINOR: tools branch must reject missing model ──────────────────────────

describe("POST /invoke — tools branch rejects missing model", () => {
  beforeEach(clearDb);

  test("returns AGENT_NO_MODEL when ollama engine has no ollamaModel", async () => {
    const conclaveId = await insertConclave({ engine: "ollama" });

    let toolsCalled = false;
    toolsState.impl = async () => {
      toolsCalled = true;
      return { output: "should-not-run" };
    };

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conclaveId,
        runId: 1,
        nodeId: "n1",
        prompt: "hi",
        tools: [{ name: "echo", description: "d", input_schema: { type: "object" } }],
      }),
    });
    expect(toolsCalled).toBe(false);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("AGENT_NO_MODEL");
  });

  test("returns AGENT_NO_MODEL when openai engine has no openaiModel", async () => {
    const conclaveId = await insertConclave({ engine: "openai", providerId: "x" });

    let toolsCalled = false;
    toolsState.impl = async () => {
      toolsCalled = true;
      return { output: "should-not-run" };
    };

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conclaveId,
        runId: 1,
        nodeId: "n1",
        prompt: "hi",
        tools: [{ name: "echo", description: "d", input_schema: { type: "object" } }],
      }),
    });
    expect(toolsCalled).toBe(false);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("AGENT_NO_MODEL");
  });
});

// ── MINOR: response shape is uniform across both branches ──────────────────

describe("POST /invoke — uniform response shape", () => {
  beforeEach(clearDb);

  test("tools branch returns { output, tool_call }", async () => {
    const conclaveId = await insertConclave({ engine: "claude", model: "sonnet" });

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conclaveId,
        runId: 1,
        nodeId: "n1",
        prompt: "hi",
        tools: [{ name: "echo", description: "d", input_schema: { type: "object" } }],
      }),
    });
    const body = (await res.json()) as { output: string; tool_call: unknown };
    expect(body.output).toBe("tools-output");
    expect(body.tool_call).toEqual({ name: "echo", input: { text: "hi" } });
  });

  test("no-tools branch returns { output, tool_call: null }", async () => {
    const conclaveId = await insertConclave({ engine: "claude", model: "sonnet" });

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conclaveId, runId: 1, nodeId: "n1", prompt: "hi" }),
    });
    const body = (await res.json()) as { output: string; tool_call: unknown };
    expect(body.output).toBe("executor-output");
    expect(body.tool_call).toBeNull();
  });

  test("tools branch with no tool_call still returns null tool_call key", async () => {
    const conclaveId = await insertConclave({ engine: "claude", model: "sonnet" });
    toolsState.result = { output: "no-call" };

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conclaveId,
        runId: 1,
        nodeId: "n1",
        prompt: "hi",
        tools: [{ name: "echo", description: "d", input_schema: { type: "object" } }],
      }),
    });
    const body = (await res.json()) as { output: string; tool_call: unknown };
    expect(body.output).toBe("no-call");
    expect(body.tool_call).toBeNull();
  });
});

// ── NIT: validation error shape for non-agent nodes ────────────────────────

describe("POST /invoke — non-agent node", () => {
  beforeEach(clearDb);

  test("returns 400 VALIDATION when node is not an agent", async () => {
    const conclaveId = await insertConclave({}, "code");

    const res = await app.request("/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conclaveId, runId: 1, nodeId: "n1", prompt: "hi" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("VALIDATION");
  });
});

// ── MINOR: GET /tasks/:id returns the task row ─────────────────────────────

describe("GET /tasks/:id", () => {
  beforeEach(clearDb);

  test("returns the task row for a numeric id", async () => {
    const inserted = await testDb
      .insert(agentTasks)
      .values({ runId: 1, nodeId: "n1", status: "success", prompt: "p", createdAt: now })
      .returning({ id: agentTasks.id });
    const id = inserted[0]!.id;

    const res = await app.request(`/tasks/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; status: string };
    expect(body.id).toBe(id);
    expect(body.status).toBe("success");
  });

  test("the legacy /tasks/:id/logs path is gone (404)", async () => {
    const inserted = await testDb
      .insert(agentTasks)
      .values({ runId: 1, nodeId: "n1", status: "success", prompt: "p", createdAt: now })
      .returning({ id: agentTasks.id });
    const id = inserted[0]!.id;

    const res = await app.request(`/tasks/${id}/logs`);
    expect(res.status).toBe(404);
  });
});

// ── NIT: non-numeric :id returns 400, not 404 ──────────────────────────────

describe("GET /tasks/:id — non-numeric id", () => {
  beforeEach(clearDb);

  test("returns 400 for a non-numeric id", async () => {
    const res = await app.request("/tasks/abc");
    expect(res.status).toBe(400);
  });

  test("returns 400 for id zero", async () => {
    const res = await app.request("/tasks/0");
    expect(res.status).toBe(400);
  });

  test("returns 404 for a numeric id that does not exist", async () => {
    const res = await app.request("/tasks/9999");
    expect(res.status).toBe(404);
  });
});
