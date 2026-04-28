import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { runs, agentTasks, runEvents } from "../../db/schema";
import { errorHandler } from "../../lib/errors";

// TEST_LIMITATION: runs.ts imports a singleton db from db/client that opens
// the real on-disk database at module load time; mock.module replaces it with
// this in-memory instance so the route is exercised without real disk state.
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
sqlite.exec(
  `CREATE TABLE checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
   node_id TEXT NOT NULL, node_outputs TEXT NOT NULL, completed_nodes TEXT NOT NULL,
   agent_sessions TEXT NOT NULL, created_at TEXT NOT NULL)`,
);

const testDb = drizzle(sqlite);

mock.module("../../db/client", () => ({ db: testDb }));

const { runRoutes } = await import("../runs");
const app = new Hono();
app.onError(errorHandler);
app.route("/", runRoutes);

const now = new Date().toISOString();

function clearDb() {
  sqlite.exec("DELETE FROM run_events");
  sqlite.exec("DELETE FROM agent_tasks");
  sqlite.exec("DELETE FROM checkpoints");
  sqlite.exec("DELETE FROM runs");
}

async function insertRun(status: string): Promise<number> {
  const rows = await testDb
    .insert(runs)
    .values({ conclaveId: 1, status, createdAt: now })
    .returning({ id: runs.id });
  return rows[0]!.id;
}

// ── cancel status guard (MAJORs #1 and #2) ──────────────────────────────────

describe("POST /:id/cancel — status guard", () => {
  beforeEach(clearDb);

  test("does not clobber a completed run", async () => {
    const id = await insertRun("success");

    const res = await app.request(`/${id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);

    const rows = await testDb.select().from(runs).where(eq(runs.id, id));
    expect(rows[0]!.status).toBe("success");
  });

  test("does not clobber a failed run", async () => {
    const id = await insertRun("failure");
    await app.request(`/${id}/cancel`, { method: "POST" });
    const rows = await testDb.select().from(runs).where(eq(runs.id, id));
    expect(rows[0]!.status).toBe("failure");
  });

  test("does cancel a queued run", async () => {
    const id = await insertRun("queued");
    await app.request(`/${id}/cancel`, { method: "POST" });
    const rows = await testDb.select().from(runs).where(eq(runs.id, id));
    expect(rows[0]!.status).toBe("cancelled");
  });

  test("does cancel a running run", async () => {
    const id = await insertRun("running");
    await app.request(`/${id}/cancel`, { method: "POST" });
    const rows = await testDb.select().from(runs).where(eq(runs.id, id));
    expect(rows[0]!.status).toBe("cancelled");
  });
});

// ── in-flight task race guard (MAJOR #2) ────────────────────────────────────

describe("POST /:id/cancel — in-flight task race guard", () => {
  beforeEach(clearDb);

  test("does not stamp a running task as cancelled", async () => {
    const runId = await insertRun("running");

    await testDb.insert(agentTasks).values([
      { runId, nodeId: "a", status: "queued", prompt: "x", createdAt: now },
      { runId, nodeId: "b", status: "pending", prompt: "x", createdAt: now },
      { runId, nodeId: "c", status: "running", prompt: "x", createdAt: now },
    ]);

    await app.request(`/${runId}/cancel`, { method: "POST" });

    const tasks = await testDb
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.runId, runId));
    const byNode: Record<string, string> = {};
    for (const t of tasks) byNode[t.nodeId] = t.status;

    expect(byNode["a"]).toBe("cancelled");
    expect(byNode["b"]).toBe("cancelled");
    expect(byNode["c"]).toBe("running");
  });
});

// ── non-numeric id guard (MINOR #3) ─────────────────────────────────────────

describe("POST /:id/cancel — non-numeric id", () => {
  beforeEach(clearDb);

  test("returns 404 for a non-numeric id", async () => {
    const res = await app.request("/abc/cancel", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("returns 404 for id zero", async () => {
    const res = await app.request("/0/cancel", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("returns 404 for a negative id", async () => {
    const res = await app.request("/-1/cancel", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

// ── GET /:id ordering (MINOR #4) ────────────────────────────────────────────

describe("GET /:id — response shape", () => {
  // TEST_LIMITATION: SQLite's typical insertion-order row return means the
  // non-determinism from a missing ORDER BY cannot be reliably reproduced
  // in-process; this test verifies the response carries tasks and events.
  beforeEach(clearDb);

  test("returns tasks and events arrays for the run", async () => {
    const runId = await insertRun("running");

    await testDb
      .insert(agentTasks)
      .values({ runId, nodeId: "n1", status: "queued", prompt: "p", createdAt: now });
    await testDb.insert(runEvents).values({ runId, type: "started", createdAt: now });

    const res = await app.request(`/${runId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { tasks: unknown[]; events: unknown[] };
    expect(body.tasks).toHaveLength(1);
    expect(body.events).toHaveLength(1);
  });
});
