/**
 * Tests for graph-walker.ts — checkpoint writing and resume logic
 *
 * Covers:
 *  - Fresh run: single node, linear chain, node failure, no entry nodes, cancellation
 *  - Checkpoint write failure is silent (does not abort execution)
 *  - Resume: skip completed nodes (node:skipped emitted, executeNode NOT called)
 *  - Resume: downstream nodes of skipped nodes execute normally
 *  - Resume: nodeOutputs hydrated from checkpoint data so downstream gets correct input
 *  - Resume: firedMerges pre-populated so completed merge nodes are not double-executed
 *  - Resume: checkpoint row missing → fresh run (fallback)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@openconclave/shared";

// ── Hoisted mocks (must be created before module imports via vi.mock hoisting) ──

const { mockDbSelect, mockDbInsert, mockDbUpdate, mockLoggerError, mockLoggerWarn } =
  vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockLoggerError: vi.fn(),
    mockLoggerWarn: vi.fn(),
  }));

const { mockExecuteNode } = vi.hoisted(() => ({
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
    warn: mockLoggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import subject under test AFTER mocks ────────────────────

import { executeGraph } from "./graph-walker";

// ── Test helpers ─────────────────────────────────────────────

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
  id: `${source}-${target}`,
  source,
  target,
  ...opts,
});

function makeWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition {
  return {
    id: "wf-1",
    name: "Test Workflow",
    nodes,
    edges,
    enabled: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

/**
 * Creates a Drizzle-like select chain that, when awaited at any point in the chain,
 * resolves to `result`. The chain methods (from/where/orderBy/limit) all return `this`.
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

/**
 * Creates a Drizzle-like insert chain.
 * - `.values()` returns a thenable (resolves or rejects based on `shouldFail`)
 * - `.returning()` resolves to `returningResult` (for INSERT ... RETURNING)
 */
function makeInsertChain(opts: { shouldFail?: boolean; returningResult?: unknown[] } = {}) {
  const { shouldFail = false, returningResult = [{ id: 1 }] } = opts;
  const valuePromise = shouldFail
    ? Promise.reject(new Error("DB insert failed"))
    : Promise.resolve(undefined);

  const valuesChain = {
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown
    ) => valuePromise.then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => valuePromise.catch(reject),
    returning: vi.fn().mockResolvedValue(returningResult),
  };

  return { values: vi.fn().mockReturnValue(valuesChain) };
}

function makeUpdateChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  chain.set.mockReturnValue(chain); // .set() returns the same chain for chaining
  return chain;
}

// ── Tests ────────────────────────────────────────────────────

describe("executeGraph", () => {
  let emit: ReturnType<typeof vi.fn>;
  let updateChain: ReturnType<typeof makeUpdateChain>;

  beforeEach(() => {
    // Reset call history and implementations for all vi.fn() mocks before each test
    vi.clearAllMocks();

    emit = vi.fn();
    updateChain = makeUpdateChain();
    mockDbUpdate.mockReturnValue(updateChain);

    // Default: run is not cancelled
    mockDbSelect.mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

    // Default: checkpoint insert succeeds
    mockDbInsert.mockReturnValue(makeInsertChain());

    // Default executeNode: sets nodeOutputs, returns output string
    mockExecuteNode.mockImplementation(
      async (
        _runId: number,
        nodeId: string,
        _nodeMap: unknown,
        _edges: unknown,
        nodeOutputs: Map<string, unknown>
      ) => {
        const output = `output-${nodeId}`;
        nodeOutputs.set(nodeId, output);
        return output;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Fresh run ───────────────────────────────────────────────

  describe("fresh run", () => {
    it("executes a single node, writes one checkpoint, and emits run:completed(success)", async () => {
      const nodes = [makeNode("node-a")];
      const workflow = makeWorkflow(nodes, []);

      await executeGraph(1, workflow, emit);

      // executeNode called once with the single node
      expect(mockExecuteNode).toHaveBeenCalledTimes(1);
      expect(mockExecuteNode.mock.calls[0][1]).toBe("node-a"); // nodeId

      // One checkpoint insert for the completed node
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      const insertedValues = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertedValues.runId).toBe(1);
      expect(insertedValues.nodeId).toBe("node-a");
      expect(insertedValues.completedNodes).toContain("node-a");

      // Run updated to success
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "success" })
      );

      // run:completed(success) emitted
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:completed", data: { status: "success" } })
      );
    });

    it("executes a linear A→B chain in order", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      await executeGraph(1, workflow, emit);

      expect(mockExecuteNode).toHaveBeenCalledTimes(2);

      // A executes before B
      const callOrder = mockExecuteNode.mock.calls.map((c) => c[1]);
      expect(callOrder[0]).toBe("node-a");
      expect(callOrder[1]).toBe("node-b");

      // Two checkpoints written (one per completed node)
      expect(mockDbInsert).toHaveBeenCalledTimes(2);

      // All db.insert() calls share the same mock chain (via mockReturnValue),
      // so both .values() calls are recorded on the single `values` vi.fn().
      // Index [1] is the second checkpoint (after node-b completed).
      const sharedInsertChain = mockDbInsert.mock.results[0].value;
      const secondCheckpoint = sharedInsertChain.values.mock.calls[1][0];
      expect(secondCheckpoint.completedNodes).toContain("node-a");
      expect(secondCheckpoint.completedNodes).toContain("node-b");
    });

    it("passes nodeOutput of A to B (output propagation via nodeOutputs)", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      // Capture nodeOutputs at the time B is executed
      let nodeOutputsAtB: Map<string, unknown> | undefined;
      mockExecuteNode.mockImplementation(
        async (
          _runId: number,
          nodeId: string,
          _nodeMap: unknown,
          _edges: unknown,
          nodeOutputs: Map<string, unknown>
        ) => {
          const output = `output-${nodeId}`;
          nodeOutputs.set(nodeId, output);
          if (nodeId === "node-b") {
            nodeOutputsAtB = new Map(nodeOutputs);
          }
          return output;
        }
      );

      await executeGraph(1, workflow, emit);

      // When B executes, A's output must already be in nodeOutputs
      expect(nodeOutputsAtB?.get("node-a")).toBe("output-node-a");
    });

    it("marks run as failed and emits run:completed(failure) when executeNode throws", async () => {
      const nodes = [makeNode("node-a")];
      const workflow = makeWorkflow(nodes, []);

      mockExecuteNode.mockRejectedValue(new Error("node exploded"));

      await executeGraph(1, workflow, emit);

      // No checkpoint should have been written (failure before checkpoint)
      expect(mockDbInsert).not.toHaveBeenCalled();

      // Run updated to failure
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failure", error: "node exploded" })
      );

      // run:completed(failure) emitted with error
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "run:completed",
          data: { status: "failure", error: "node exploded" },
        })
      );
    });

    it("marks run as failed when no entry nodes exist", async () => {
      // node-b has an incoming edge from an external node → not an entry
      const nodes = [makeNode("node-b")];
      const edges = [makeEdge("phantom-a", "node-b")]; // phantom-a not in nodes
      const workflow = makeWorkflow(nodes, edges);

      await executeGraph(1, workflow, emit);

      expect(mockExecuteNode).not.toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failure" })
      );
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:completed", data: expect.objectContaining({ status: "failure" }) })
      );
    });

    it("stops execution and emits run:completed(cancelled) when run status is cancelled", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      // Cancellation check returns "cancelled" — happens at the start of the first iteration
      mockDbSelect.mockReturnValue(makeSelectChain([{ id: 1, status: "cancelled" }]));

      await executeGraph(1, workflow, emit);

      // No node should have executed
      expect(mockExecuteNode).not.toHaveBeenCalled();

      // run:completed(cancelled) emitted
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "run:completed",
          data: { status: "cancelled" },
        })
      );

      // run status NOT updated to failure/success (early return before update)
      expect(updateChain.set).not.toHaveBeenCalled();
    });

    it("completes successfully even when checkpoint DB insert fails (silent degradation)", async () => {
      const nodes = [makeNode("node-a")];
      const workflow = makeWorkflow(nodes, []);

      // Checkpoint insert fails
      mockDbInsert.mockReturnValue(makeInsertChain({ shouldFail: true }));

      await executeGraph(1, workflow, emit);

      // executeNode still ran
      expect(mockExecuteNode).toHaveBeenCalledTimes(1);

      // Run still succeeds
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "success" })
      );
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:completed", data: { status: "success" } })
      );

      // Error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        "Failed to write checkpoint",
        expect.objectContaining({ runId: 1, nodeId: "node-a" })
      );
    });
  });

  // ── Checkpoint content ──────────────────────────────────────

  describe("checkpoint data integrity", () => {
    it("checkpoint nodeOutputs stores raw executeNode output (not condition passthrough)", async () => {
      // A condition node's raw output is { __conditionResult, __passthrough }.
      // resolveNextEntries overwrites nodeOutputs[nodeId] with just the passthrough value.
      // But checkpointOutputs (what writeCheckpoint stores) must keep the raw output
      // so that on resume, resolveNextEntries can correctly determine the branch.

      const condNode = makeNode("cond", "condition");
      const trueNode = makeNode("true-branch");
      const falseNode = makeNode("false-branch");
      const nodes = [condNode, trueNode, falseNode];
      const edges = [
        makeEdge("cond", "true-branch", { sourceHandle: "true" }),
        makeEdge("cond", "false-branch", { sourceHandle: "false" }),
      ];
      const workflow = makeWorkflow(nodes, edges);

      // condition node returns raw output with __conditionResult
      const rawCondOutput = { __conditionResult: true, __passthrough: "passed-value" };
      mockExecuteNode.mockImplementation(
        async (_runId: number, nodeId: string, _nodeMap: unknown, _edges: unknown, nodeOutputs: Map<string, unknown>) => {
          if (nodeId === "cond") {
            nodeOutputs.set(nodeId, rawCondOutput);
            return rawCondOutput;
          }
          const output = `output-${nodeId}`;
          nodeOutputs.set(nodeId, output);
          return output;
        }
      );

      await executeGraph(1, workflow, emit);

      // Find the checkpoint written for the condition node (first checkpoint)
      const condCheckpointCall = mockDbInsert.mock.results.find(
        (r) => r.value.values.mock.calls[0]?.[0]?.nodeId === "cond"
      );
      expect(condCheckpointCall).toBeDefined();
      const storedOutputs = condCheckpointCall!.value.values.mock.calls[0][0].nodeOutputs;

      // Raw output (with __conditionResult) must be preserved in the checkpoint
      expect(storedOutputs["cond"]).toEqual(rawCondOutput);
      expect(storedOutputs["cond"]).toHaveProperty("__conditionResult", true);
    });
  });

  // ── Resume logic ────────────────────────────────────────────

  describe("resume from checkpoint", () => {
    it("skips completed nodes: emits node:skipped and does NOT call executeNode", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      const checkpoint = {
        id: 42,
        runId: 1,
        nodeId: "node-a",
        nodeOutputs: { "node-a": "output-node-a" },
        completedNodes: ["node-a"],
        agentSessions: {},
        createdAt: "2024-01-01T00:00:00Z",
      };

      // First select call: checkpoint lookup; subsequent: cancellation checks
      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([checkpoint]))
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

      await executeGraph(1, workflow, emit, undefined, undefined, 42);

      // node:skipped emitted for node-a
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "node:skipped", nodeId: "node-a" })
      );

      // executeNode NOT called for node-a
      const executedNodeIds = mockExecuteNode.mock.calls.map((c) => c[1]);
      expect(executedNodeIds).not.toContain("node-a");
    });

    it("executes downstream node-b after skipping completed node-a", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      const checkpoint = {
        id: 42,
        runId: 1,
        nodeId: "node-a",
        nodeOutputs: { "node-a": "output-node-a" },
        completedNodes: ["node-a"],
        agentSessions: {},
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([checkpoint]))
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

      await executeGraph(1, workflow, emit, undefined, undefined, 42);

      // executeNode called for node-b (but not node-a)
      const executedNodeIds = mockExecuteNode.mock.calls.map((c) => c[1]);
      expect(executedNodeIds).toContain("node-b");
      expect(executedNodeIds).not.toContain("node-a");

      // Run completes successfully
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:completed", data: { status: "success" } })
      );
    });

    it("hydrates nodeOutputs from checkpoint so skipped node output is available downstream", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      const checkpoint = {
        id: 42,
        runId: 1,
        nodeId: "node-a",
        nodeOutputs: { "node-a": "checkpoint-output-A" },
        completedNodes: ["node-a"],
        agentSessions: {},
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([checkpoint]))
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

      // Capture the nodeOutputs map at the time node-b executes
      let nodeOutputsAtB: Map<string, unknown> | undefined;
      mockExecuteNode.mockImplementation(
        async (_runId: number, nodeId: string, _nodeMap: unknown, _edges: unknown, nodeOutputs: Map<string, unknown>) => {
          if (nodeId === "node-b") {
            nodeOutputsAtB = new Map(nodeOutputs);
          }
          const output = `output-${nodeId}`;
          nodeOutputs.set(nodeId, output);
          return output;
        }
      );

      await executeGraph(1, workflow, emit, undefined, undefined, 42);

      // node-b should see node-a's checkpoint output in nodeOutputs
      expect(nodeOutputsAtB?.get("node-a")).toBe("checkpoint-output-A");
    });

    it("writes only new checkpoint for node-b (not for skipped node-a)", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      const checkpoint = {
        id: 42,
        runId: 1,
        nodeId: "node-a",
        nodeOutputs: { "node-a": "output-node-a" },
        completedNodes: ["node-a"],
        agentSessions: {},
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([checkpoint]))
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

      await executeGraph(1, workflow, emit, undefined, undefined, 42);

      // Only one checkpoint insert (for node-b, since node-a was skipped)
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      // Single insert call — values.mock.calls[0][0] is the checkpoint data
      const sharedInsertChain = mockDbInsert.mock.results[0].value;
      const writtenCheckpoint = sharedInsertChain.values.mock.calls[0][0];
      expect(writtenCheckpoint.nodeId).toBe("node-b");
      // Accumulated snapshot includes both nodes (A was hydrated from checkpoint)
      expect(writtenCheckpoint.completedNodes).toContain("node-a");
      expect(writtenCheckpoint.completedNodes).toContain("node-b");
    });

    it("restores agent sessions from checkpoint", async () => {
      // Verify that agentSessions from checkpoint are hydrated
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      const checkpoint = {
        id: 42,
        runId: 1,
        nodeId: "node-a",
        nodeOutputs: { "node-a": "output-a" },
        completedNodes: ["node-a"],
        agentSessions: { "node-a": "session-abc-123" },
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([checkpoint]))
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

      // Capture agentSessions when node-b runs
      let capturedSessions: Map<string, string> | undefined;
      mockExecuteNode.mockImplementation(
        async (_runId: number, nodeId: string, _nodeMap: unknown, _edges: unknown,
          nodeOutputs: Map<string, unknown>, agentSessions: Map<string, string>) => {
          if (nodeId === "node-b") capturedSessions = new Map(agentSessions);
          nodeOutputs.set(nodeId, `output-${nodeId}`);
          return `output-${nodeId}`;
        }
      );

      await executeGraph(1, workflow, emit, undefined, undefined, 42);

      // Agent session from checkpoint is visible when node-b runs
      expect(capturedSessions?.get("node-a")).toBe("session-abc-123");
    });

    it("falls back to fresh run when checkpoint row is not found in DB", async () => {
      const nodes = [makeNode("node-a"), makeNode("node-b")];
      const edges = [makeEdge("node-a", "node-b")];
      const workflow = makeWorkflow(nodes, edges);

      // First call: checkpoint lookup returns empty (row deleted or never written)
      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([]))   // checkpoint not found
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

      await executeGraph(1, workflow, emit, undefined, undefined, 99);

      // Both nodes execute (fresh run fallback)
      const executedNodeIds = mockExecuteNode.mock.calls.map((c) => c[1]);
      expect(executedNodeIds).toContain("node-a");
      expect(executedNodeIds).toContain("node-b");
    });

    it("pre-populates firedMerges for completed merge nodes to prevent double-execution", async () => {
      // Scenario: two inputs (A, B) feed a merge node. Merge was already completed.
      // On resume, the merge node must not be re-executed.
      const mergeNode = makeNode("merge", "merge");
      const nodeA = makeNode("node-a");
      const nodeB = makeNode("node-b");
      const nodes = [nodeA, nodeB, mergeNode];
      const edges = [makeEdge("node-a", "merge"), makeEdge("node-b", "merge")];
      const workflow = makeWorkflow(nodes, edges);

      const checkpoint = {
        id: 42,
        runId: 1,
        nodeId: "merge",
        nodeOutputs: { "node-a": "output-a", "node-b": "output-b", "merge": "merged" },
        completedNodes: ["node-a", "node-b", "merge"],
        agentSessions: {},
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockDbSelect
        .mockReturnValueOnce(makeSelectChain([checkpoint]))
        .mockReturnValue(makeSelectChain([{ id: 1, status: "running" }]));

      await executeGraph(1, workflow, emit, undefined, undefined, 42);

      // No node should be re-executed — all are in completedNodes
      expect(mockExecuteNode).not.toHaveBeenCalled();

      // merge node must NOT be executed
      const executedNodeIds = mockExecuteNode.mock.calls.map((c) => c[1]);
      expect(executedNodeIds).not.toContain("merge");
    });
  });
});
