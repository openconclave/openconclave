/**
 * Tests for routes/runs.ts
 *
 * Key behaviors under test:
 *  - GET /:id returns checkpoint field as `{ completedNodes, createdAt }` when a checkpoint exists
 *  - GET /:id returns checkpoint field as `null` when no checkpoint exists for the run
 *  - GET /:id returns 404 when run is not found
 *  - POST /:id/cancel updates run + tasks to cancelled and calls clearPromptsForRun
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { AppError } from "@openconclave/shared";

// ── Mocks ────────────────────────────────────────────────────

vi.mock("../db/client", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../engine/prompt-registry", () => ({
  clearPromptsForRun: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { db } from "../../db/client";
import { clearPromptsForRun } from "../../engine/prompt-registry";
import { runRoutes } from "../runs";

// ── Test app ─────────────────────────────────────────────────

function createTestApp() {
  const app = new Hono();
  app.route("/api/runs", runRoutes);
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(err.toJSON(), err.statusCode as 400 | 404 | 500);
    }
    return c.json({ error: { code: "INTERNAL", message: String(err) } }, 500);
  });
  return app;
}

// ── DB chain helpers ──────────────────────────────────────────

/**
 * Returns a thenable select chain that resolves to `result` when awaited.
 * All methods (from/where/orderBy/limit) return the same chain for chaining.
 */
function makeSelectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {
    then: (
      resolve: (v: unknown[]) => unknown,
      reject?: (e: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve(result).catch(reject),
  };
  const returnChain = vi.fn().mockImplementation(() => chain);
  chain.from = returnChain;
  chain.where = returnChain;
  chain.orderBy = returnChain;
  chain.limit = returnChain;
  return chain;
}

function makeUpdateChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  chain.set.mockReturnValue(chain);
  return chain;
}

// ── Sample fixtures ───────────────────────────────────────────

const sampleRun = {
  id: 1,
  workflowId: 10,
  status: "failure",
  triggerType: "manual",
  triggerPayload: null,
  startedAt: "2024-01-01T10:00:00Z",
  completedAt: "2024-01-01T10:01:00Z",
  error: "Node failed",
  createdAt: "2024-01-01T10:00:00Z",
};

const sampleCheckpoint = {
  id: 7,
  runId: 1,
  nodeId: "node-a",
  nodeOutputs: { "node-a": "output-a" },
  completedNodes: ["node-a", "node-b"],
  agentSessions: {},
  createdAt: "2024-01-01T10:00:30Z",
};

// ── Tests ────────────────────────────────────────────────────

describe("GET /api/runs/:id", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns checkpoint field with completedNodes and createdAt when checkpoint exists", async () => {
    // GET /:id makes 4 select calls: runs → agentTasks → runEvents → checkpoints
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain([sampleRun]))        // runs
      .mockReturnValueOnce(makeSelectChain([]))                  // agentTasks
      .mockReturnValueOnce(makeSelectChain([]))                  // runEvents
      .mockReturnValueOnce(makeSelectChain([sampleCheckpoint])); // checkpoints

    const res = await app.request("/api/runs/1");
    expect(res.status).toBe(200);

    const body = await res.json() as { checkpoint: unknown };
    expect(body.checkpoint).toEqual({
      completedNodes: ["node-a", "node-b"],
      createdAt: "2024-01-01T10:00:30Z",
    });
  });

  it("returns checkpoint as null when no checkpoint exists for the run", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain([sampleRun]))  // runs
      .mockReturnValueOnce(makeSelectChain([]))            // agentTasks
      .mockReturnValueOnce(makeSelectChain([]))            // runEvents
      .mockReturnValueOnce(makeSelectChain([]));           // checkpoints — empty

    const res = await app.request("/api/runs/1");
    expect(res.status).toBe(200);

    const body = await res.json() as { checkpoint: unknown };
    expect(body.checkpoint).toBeNull();
  });

  it("does NOT expose nodeOutputs or agentSessions in the checkpoint response", async () => {
    // These fields contain potentially sensitive internal state and should be stripped
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain([sampleRun]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([sampleCheckpoint]));

    const res = await app.request("/api/runs/1");
    const body = await res.json() as { checkpoint: Record<string, unknown> | null };

    expect(body.checkpoint).not.toBeNull();
    expect(body.checkpoint).not.toHaveProperty("nodeOutputs");
    expect(body.checkpoint).not.toHaveProperty("agentSessions");
    expect(body.checkpoint).not.toHaveProperty("id");
    expect(body.checkpoint).not.toHaveProperty("runId");
  });

  it("returns run, tasks, and events alongside the checkpoint", async () => {
    const task = { id: 1, runId: 1, nodeId: "node-a", status: "success" };
    const event = { id: 1, runId: 1, type: "node:started", nodeId: "node-a" };

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain([sampleRun]))
      .mockReturnValueOnce(makeSelectChain([task]))
      .mockReturnValueOnce(makeSelectChain([event]))
      .mockReturnValueOnce(makeSelectChain([])); // no checkpoint

    const res = await app.request("/api/runs/1");
    const body = await res.json() as { run: unknown; tasks: unknown[]; events: unknown[] };

    expect(body.run).toMatchObject({ id: 1, status: "failure" });
    expect(body.tasks).toHaveLength(1);
    expect(body.events).toHaveLength(1);
  });

  it("returns 404 when run is not found", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain([])); // runs — empty

    const res = await app.request("/api/runs/999");
    expect(res.status).toBe(404);

    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

// ── POST /:id/cancel ─────────────────────────────────────────

describe("POST /api/runs/:id/cancel", () => {
  let app: Hono;
  let updateChain: ReturnType<typeof makeUpdateChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    updateChain = makeUpdateChain();
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates run and tasks to cancelled and returns { cancelled: true }", async () => {
    const res = await app.request("/api/runs/1/cancel", { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ cancelled: true });

    // Two update calls: one for runs, one for agentTasks
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it("sets status to 'cancelled' for the run", async () => {
    await app.request("/api/runs/1/cancel", { method: "POST" });

    const [firstUpdateTable] = (db.update as ReturnType<typeof vi.fn>).mock.calls[0];
    // First update is for the runs table
    expect(firstUpdateTable).toBeDefined();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("calls clearPromptsForRun with the correct run ID", async () => {
    await app.request("/api/runs/42/cancel", { method: "POST" });

    expect(clearPromptsForRun).toHaveBeenCalledWith(42);
  });
});
