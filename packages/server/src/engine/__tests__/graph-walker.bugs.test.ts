/**
 * RED tests for bugs identified in code review (2026-04-08)
 *
 * Each test is designed to FAIL if the described bug is real.
 * Do NOT fix the bugs here — only prove they exist.
 *
 * Bugs covered:
 *  1. Memory Leak     — persistentSessions Map is unbounded (no TTL/LRU eviction)
 *  2. Write Amplification — writeCheckpoint stores full accumulated state after every node (O(n²))
 *  3. Failure Side Effects — Promise.all lets sibling nodes run after a parallel node fails
 *  4. Race Condition  — resumeSkipNodes.delete() inside Promise.all means the same node ID
 *                       appearing twice in `ready` skips once then executes once
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@openconclave/shared";

// ── Hoisted mocks ────────────────────────────────────────────

const { mockDbSelect, mockDbInsert, mockDbUpdate, mockLoggerError, mockExecuteNode } =
  vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockLoggerError: vi.fn(),
    mockExecuteNode: vi.fn(),
  }));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
}));

vi.mock("./node-executor", () => ({
  executeNode: mockExecuteNode,
}));

vi.mock("../lib/logger", () => ({
  logger: {
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// normalize-workflow uses a deep sub-path import (@openconclave/shared/src/constants)
// that the Vitest Node resolver cannot find without extra config.  Mock it here so
// the alias gap doesn't prevent loading graph-walker.ts under test.
vi.mock("./normalize-workflow", () => ({
  normalizeWorkflowNodeTypes: (wf: unknown) => wf,
}));

// ── Subject under test ───────────────────────────────────────

import { executeGraph, getPersistentSession, setPersistentSession } from "../graph-walker";

// ── Helpers (mirrors graph-walker.test.ts) ───────────────────

const makeNode = (id: string, type = "agent"): WorkflowNode => ({
  id,
  type: "default" as WorkflowNode["type"],
  position: { x: 0, y: 0 },
  data: {
    label: id,
    type: type as WorkflowNode["data"]["type"],
    config: {},
  },
});

const makeEdge = (
  source: string,
  target: string,
  opts: { sourceHandle?: string; targetHandle?: string } = {}
): WorkflowEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  ...opts,
});

function makeWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition {
  return {
    id: "wf-bugs",
    name: "Bug Test Workflow",
    nodes,
    edges,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
  };
  const returnSelf = vi.fn().mockImplementation(() => chain);
  chain.from = returnSelf;
  chain.where = returnSelf;
  chain.orderBy = returnSelf;
  chain.limit = returnSelf;
  return chain;
}

function makeInsertChain() {
  const valuesChain = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  };
  return { values: vi.fn().mockReturnValue(valuesChain) };
}

function makeUpdateChain() {
  const chain = { set: vi.fn(), where: vi.fn().mockResolvedValue(undefined) };
  chain.set.mockReturnValue(chain);
  return chain;
}

// ── Test suite ───────────────────────────────────────────────

describe("graph-walker bugs (RED tests — expected to FAIL until bugs are fixed)", () => {
  let emit: ReturnType<typeof vi.fn>;
  let updateChain: ReturnType<typeof makeUpdateChain>;

  beforeEach(() => {
    vi.clearAllMocks();

    emit = vi.fn();
    updateChain = makeUpdateChain();
    mockDbUpdate.mockReturnValue(updateChain);
    mockDbSelect.mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));
    mockDbInsert.mockReturnValue(makeInsertChain());

    mockExecuteNode.mockImplementation(
      async (_runId: number, nodeId: string, _nodeMap: unknown, _edges: unknown, nodeOutputs: Map<string, unknown>) => {
        const output = `output-${nodeId}`;
        nodeOutputs.set(nodeId, output);
        return output;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Bug 1: Memory Leak ──────────────────────────────────────
  //
  // `persistentSessions` is a module-level Map with no eviction policy.
  // Sessions accumulate indefinitely. A session written for run #1 is still
  // present after thousands of later sessions are written.
  //
  // Expected (correct behaviour): old sessions should be evicted (TTL or LRU).
  // Actual   (bug):               every session persists forever — no eviction.

  describe("Bug 1 — Memory Leak: persistentSessions is unbounded", () => {
    it("RED: sessions written for old runs should be evicted after a reasonable threshold is reached", () => {
      // Use a unique run-ID namespace to avoid cross-test pollution from the
      // shared module-level Map.
      const BASE_RUN_ID = 900_000;
      const SESSION_COUNT = 500;

      // Flood the cache with many different run-scoped sessions
      for (let i = 0; i < SESSION_COUNT; i++) {
        setPersistentSession(BASE_RUN_ID + i, "node-x", `session-${i}`);
      }

      // A correct implementation with LRU/TTL eviction would have dropped the
      // very first entry by now.  The bug: it is still present.
      //
      // This assertion will FAIL (RED) because there is no eviction — the Map
      // just grows without bound and the first entry is still retrievable.
      expect(getPersistentSession(BASE_RUN_ID, "node-x")).toBeUndefined();
    });
  });

  // ── Bug 2: Checkpointing Write Amplification ────────────────
  //
  // writeCheckpoint() stores the entire accumulated nodeOutputs + completedNodes
  // snapshot after EVERY node execution.  For a workflow with n nodes this means:
  //   - checkpoint 1 contains 1 entry
  //   - checkpoint 2 contains 2 entries
  //   - …
  //   - checkpoint n contains n entries
  // Total rows written = n,  total data stored = 1+2+…+n = O(n²).
  //
  // Expected (correct behaviour): only the latest (or a pruned set of) checkpoint
  //   rows should be retained.  At minimum, a 5-node chain should write at most
  //   1 checkpoint (or old rows should be deleted after each new one).
  // Actual   (bug):               5 checkpoint INSERT rows are written.

  describe("Bug 2 — Checkpointing Write Amplification: O(n²) checkpoint storage", () => {
    it("RED: a 5-node linear chain should write at most 1 checkpoint row (not 5)", async () => {
      const nodes = [
        makeNode("n1"), makeNode("n2"), makeNode("n3"), makeNode("n4"), makeNode("n5"),
      ];
      const edges = [
        makeEdge("n1", "n2"), makeEdge("n2", "n3"),
        makeEdge("n3", "n4"), makeEdge("n4", "n5"),
      ];
      const workflow = makeWorkflow(nodes, edges);

      // Separate insert chains per call so we can count them independently
      const insertChains = Array.from({ length: 10 }, () => makeInsertChain());
      let insertCallCount = 0;
      mockDbInsert.mockImplementation(() => insertChains[insertCallCount++]);

      await executeGraph(1, workflow, emit);

      // The workflow has 5 nodes — 5 checkpoints are written (one per node).
      // A correct implementation would prune or write only the final snapshot.
      //
      // This assertion FAILS (RED) because 5 INSERT calls are made, not 1.
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
    });

    it("RED: checkpoint rows for a 4-node chain accumulate O(n²) total completedNode entries", async () => {
      const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")];
      const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("c", "d")];
      const workflow = makeWorkflow(nodes, edges);

      const capturedCheckpoints: Array<{ completedNodes: string[] }> = [];
      mockDbInsert.mockImplementation(() => {
        const chain = {
          values: vi.fn().mockImplementation((data) => {
            capturedCheckpoints.push(data);
            return {
              then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r),
              catch: (r: (e: unknown) => unknown) => Promise.resolve(undefined).catch(r),
            };
          }),
        };
        return chain;
      });

      await executeGraph(1, workflow, emit);

      // Total completedNode entries stored across all checkpoint rows:
      //   row1: [a]       → 1
      //   row2: [a,b]     → 2
      //   row3: [a,b,c]   → 3
      //   row4: [a,b,c,d] → 4
      //   sum  = 10  (O(n²) for n=4)
      //
      // A correct implementation stores only the latest row → total = 4 (O(n)).
      // This assertion FAILS (RED) because total = 10, not 4.
      const totalEntries = capturedCheckpoints.reduce(
        (sum, cp) => sum + cp.completedNodes.length,
        0
      );
      expect(totalEntries).toBe(nodes.length); // 4, not 10
    });
  });

  // ── Bug 3: Failure Side Effects ─────────────────────────────
  //
  // The inner `Promise.all` in the execution loop does not use AbortController
  // or any cancellation mechanism.  When one node throws, Promise.all rejects
  // immediately — but the other sibling promises keep running to completion,
  // including all their side effects (DB writes, API calls, etc.).
  //
  // Expected (correct behaviour): once any node fails, sibling nodes should be
  //   cancelled / not produce side effects.
  // Actual   (bug):               sibling node B executes fully even after A fails.

  describe("Bug 3 — Failure Side Effects: Promise.all allows sibling execution after failure", () => {
    it("RED: sibling node B should NOT execute when parallel node A throws", async () => {
      // A and B are independent entry nodes that run in the same parallel batch.
      const nodeA = makeNode("node-a");
      const nodeB = makeNode("node-b");
      const workflow = makeWorkflow([nodeA, nodeB], []);

      let nodeB_wasCalled = false;

      mockExecuteNode.mockImplementation(
        async (_runId: number, nodeId: string, _nodeMap: unknown, _edges: unknown, nodeOutputs: Map<string, unknown>) => {
          if (nodeId === "node-a") {
            throw new Error("node-a exploded");
          }
          if (nodeId === "node-b") {
            nodeB_wasCalled = true;
            nodeOutputs.set(nodeId, "output-b");
            return "output-b";
          }
        }
      );

      await executeGraph(1, workflow, emit);

      // The run should have failed due to node-a
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:completed", data: expect.objectContaining({ status: "failure" }) })
      );

      // Bug: node-b's executeNode IS called even though node-a failed.
      // This assertion FAILS (RED) because nodeB_wasCalled === true.
      expect(nodeB_wasCalled).toBe(false);
    });
  });

  // ── Bug 4: State Race Condition ─────────────────────────────
  //
  // resumeSkipNodes.delete(nodeId) runs synchronously (no await) inside the
  // Promise.all callback.  When the SAME node ID appears twice in the `ready`
  // array (e.g. two parallel parent nodes were both skipped and both route to
  // the same child), the map() processes the callbacks synchronously:
  //
  //   callback[0]: has(C) = true  → delete(C) → skip (no await, returns immediately)
  //   callback[1]: has(C) = false → falls through → await executeNode(C) → EXECUTES
  //
  // Expected (correct behaviour): C is skipped for every occurrence in `ready`.
  // Actual   (bug):               C executes once (second occurrence bypasses the guard).

  describe("Bug 4 — Race Condition: resumeSkipNodes double-entry in Promise.all", () => {
    it("RED: node C should NOT execute when it appears twice in ready because both parallel parents were skipped", async () => {
      // Topology: A → C   and   B → C   (A and B are independent entry nodes)
      // Checkpoint contains A, B, and C as completed.
      // On resume, A and B are both skipped and each returns C as the next entry.
      // C therefore appears TWICE in the ready array of the following iteration.
      const nodeA = makeNode("node-a");
      const nodeB = makeNode("node-b");
      const nodeC = makeNode("node-c");
      const nodes = [nodeA, nodeB, nodeC];
      const edges = [makeEdge("node-a", "node-c"), makeEdge("node-b", "node-c")];
      const workflow = makeWorkflow(nodes, edges);

      const checkpoint = {
        id: 42,
        runId: 1,
        nodeId: "node-c",
        nodeOutputs: {
          "node-a": "out-a",
          "node-b": "out-b",
          "node-c": "out-c",
        },
        completedNodes: ["node-a", "node-b", "node-c"],
        agentSessions: {},
        createdAt: "2026-01-01T00:00:00Z",
      };

      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([checkpoint]))          // checkpoint lookup
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }])); // cancellation checks

      await executeGraph(1, workflow, emit, undefined, undefined, 42);

      // All three nodes are in the checkpoint — none should execute.
      const executedIds = mockExecuteNode.mock.calls.map((c) => c[1] as string);

      // Bug: node-c IS executed (the second ready entry bypasses the skip guard).
      // This assertion FAILS (RED) because executedIds contains "node-c".
      expect(executedIds).not.toContain("node-c");

      // Verify the run still completes (the bug causes spurious extra work, not a crash)
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:completed", data: { status: "success" } })
      );
    });
  });
});
