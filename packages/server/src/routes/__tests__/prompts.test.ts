import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";
import { errorHandler } from "../../lib/errors";

// TEST_LIMITATION: routes/prompts.ts loads the singleton db client at module
// import time; mock.module replaces it with this in-memory instance.
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

const testDb = drizzle(sqlite);
mock.module("../../db/client", () => ({ db: testDb }));

interface CapturedBroadcast {
  event: { type: string; runId: number; nodeId: string; data: Record<string, unknown> };
  pendingSize: number;
}
const broadcasts: CapturedBroadcast[] = [];
let pendingSizeFn = () => 0;

mock.module("../../ws/broadcast", () => ({
  broadcastRunEvent: (event: CapturedBroadcast["event"]) => {
    broadcasts.push({ event, pendingSize: pendingSizeFn() });
  },
  broadcastToTopic: () => {},
  setServer: () => {},
}));

const { promptRoutes } = await import("../prompts");
const promptRegistry = await import("../../engine/prompt-registry");
pendingSizeFn = () => promptRegistry.getPendingPrompts().length;
const { respondToPrompt, clearPromptsForRun } = promptRegistry;

const app = new Hono();
app.onError(errorHandler);
app.route("/", promptRoutes);

const now = new Date().toISOString();
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));

function seed(opts: {
  runId: number;
  conclaveId: number;
  conclaveName: string;
  nodeId: string;
  nodeLabel: string;
}) {
  sqlite.run(
    `INSERT INTO conclaves (id, name, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [
      opts.conclaveId,
      opts.conclaveName,
      JSON.stringify({
        nodes: [
          {
            id: opts.nodeId,
            type: "agent",
            position: { x: 0, y: 0 },
            data: { label: opts.nodeLabel, type: "agent", config: {} },
          },
        ],
        edges: [],
      }),
      now,
      now,
    ],
  );
  sqlite.run(
    `INSERT INTO runs (id, conclave_id, status, created_at) VALUES (?, ?, ?, ?)`,
    [opts.runId, opts.conclaveId, "running", now],
  );
}

beforeEach(() => {
  sqlite.exec("DELETE FROM runs");
  sqlite.exec("DELETE FROM conclaves");
  broadcasts.length = 0;
});

afterEach(() => {
  for (const p of promptRegistry.getPendingPrompts()) {
    clearPromptsForRun(p.runId);
  }
});

// ── MAJOR #1: register-before-broadcast ─────────────────────────────────────

describe("POST /ask — registers prompt before broadcasting", () => {
  test(
    "when broadcastRunEvent fires, the pending entry is already present",
    async () => {
      seed({ runId: 100, conclaveId: 1, conclaveName: "C1", nodeId: "n1", nodeLabel: "Ask" });

      const reqPromise = Promise.resolve(
        app.request("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: 100, nodeId: "n1", question: "What?" }),
        }),
      ).catch(() => null);

      await tick();

      expect(broadcasts.length).toBe(1);
      expect(broadcasts[0]!.pendingSize).toBe(1);

      respondToPrompt(100, "n1", "answer");
      const res = await reqPromise;
      expect(res?.status).toBe(200);
      expect(await res!.json()).toEqual({ response: "answer" });
    },
    2000,
  );
});

// ── MAJOR #2: client disconnect aborts pending prompt ───────────────────────

describe("POST /ask — wires the request abort signal into registerPrompt", () => {
  test(
    "aborting the request signal removes the pending entry",
    async () => {
      seed({ runId: 200, conclaveId: 2, conclaveName: "C2", nodeId: "n2", nodeLabel: "Ask" });

      const ctrl = new AbortController();
      const reqPromise = Promise.resolve(
        app.request("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: 200, nodeId: "n2", question: "What?" }),
          signal: ctrl.signal,
        }),
      ).catch(() => null);

      await tick();
      expect(
        promptRegistry.getPendingPrompts().some((p) => p.runId === 200 && p.nodeId === "n2"),
      ).toBe(true);

      ctrl.abort();
      await tick();

      expect(
        promptRegistry.getPendingPrompts().some((p) => p.runId === 200 && p.nodeId === "n2"),
      ).toBe(false);

      await reqPromise;
    },
    2000,
  );
});

// ── MINOR #4: event shape uses real conclaveName / nodeLabel ────────────────

describe("POST /ask — event shape", () => {
  test(
    "populates conclaveName and nodeLabel from DB",
    async () => {
      seed({
        runId: 300,
        conclaveId: 3,
        conclaveName: "My Conclave",
        nodeId: "ask1",
        nodeLabel: "Ask The User",
      });

      const reqPromise = Promise.resolve(
        app.request("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: 300, nodeId: "ask1", question: "Q?" }),
        }),
      ).catch(() => null);

      await tick();
      expect(broadcasts.length).toBe(1);
      const ev = broadcasts[0]!.event;
      expect(ev.type).toBe("prompt:question");
      expect(ev.data.conclaveName).toBe("My Conclave");
      expect(ev.data.nodeLabel).toBe("Ask The User");

      respondToPrompt(300, "ask1", "ok");
      await reqPromise;
    },
    2000,
  );
});

// ── NIT #7: body validation via zValidator ──────────────────────────────────

// Hono's app.request awaits the handler; if the unfixed handler hangs in
// registerPrompt, the request never resolves. Race against an explicit timeout
// so the assertion can fail with a clear error instead of the suite hanging.
async function requestWithDeadline(path: string, body: unknown, deadlineMs = 1000): Promise<Response | null> {
  const req = app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await Promise.race([
    req,
    new Promise<null>((r) => setTimeout(() => r(null), deadlineMs)),
  ]);
}

describe("POST /ask — body validation", () => {
  test(
    "rejects missing runId with 400",
    async () => {
      const res = await requestWithDeadline("/ask", { nodeId: "n", question: "Q" });
      expect(res?.status).toBe(400);
    },
    3000,
  );

  test(
    "rejects non-string question with 400",
    async () => {
      const res = await requestWithDeadline("/ask", { runId: 1, nodeId: "n", question: 123 });
      expect(res?.status).toBe(400);
    },
    3000,
  );
});

describe("POST /respond — body validation", () => {
  test(
    "rejects missing fields with 400",
    async () => {
      const res = await requestWithDeadline("/respond", { runId: 1 });
      expect(res?.status).toBe(400);
    },
    3000,
  );
});
