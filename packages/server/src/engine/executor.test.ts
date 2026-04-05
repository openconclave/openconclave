/**
 * Tests for executor.ts — WorkflowExecutor (resume + execute methods)
 *
 * Covers:
 *  - resume(): queries latest checkpoint by runId
 *  - resume(): passes checkpoint ID to executeGraph
 *  - resume(): passes undefined to executeGraph when no checkpoint exists (fresh retry)
 *  - resume(): emits run:started event via onEvent callback
 *  - resume(): identifies trigger node as triggerNodeId passed to executeGraph
 *  - execute(): creates run record in DB and returns runId
 *  - execute(): fires executeGraph asynchronously (non-blocking)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@openconclave/shared";

// ── Hoisted mocks ────────────────────────────────────────────

const { mockDbSelect, mockDbInsert, mockDbUpdate, mockExecuteGraph } =
  vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockExecuteGraph: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
}));

vi.mock("./graph-walker", () => ({
  executeGraph: mockExecuteGraph,
  getPersistentSession: vi.fn(),
  setPersistentSession: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import subject under test AFTER mocks ────────────────────

import { WorkflowExecutor } from "./executor";

// ── Test helpers ─────────────────────────────────────────────

const makeNode = (id: string, type = "agent"): WorkflowNode => ({
  id,
  type: "default" as WorkflowNode["type"],
  position: { x: 0, y: 0 },
  data: { label: id, type: type as WorkflowNode["data"]["type"], config: {} },
});

const makeEdge = (source: string, target: string): WorkflowEdge => ({
  id: `${source}-${target}`,
  source,
  target,
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
 * Thenable chain used for select queries.
 * Awaiting at any point in the chain resolves to `result`.
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

/** Insert chain with optional `.returning()` */
function makeInsertChain(returningResult: unknown[] = [{ id: 1 }]) {
  const valuesChain = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve(undefined).catch(reject),
    returning: vi.fn().mockResolvedValue(returningResult),
  };
  return { values: vi.fn().mockReturnValue(valuesChain) };
}

// ── Tests ────────────────────────────────────────────────────

describe("WorkflowExecutor", () => {
  let onEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    onEvent = vi.fn();

    // Default: runEvents insert succeeds
    mockDbInsert.mockReturnValue(makeInsertChain());

    // Default: executeGraph resolves immediately
    mockExecuteGraph.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── resume() ────────────────────────────────────────────────

  describe("resume()", () => {
    it("queries checkpoints table by runId to find the latest checkpoint", async () => {
      const checkpoint = {
        id: 55,
        runId: 10,
        nodeId: "node-a",
        nodeOutputs: {},
        completedNodes: ["node-a"],
        agentSessions: {},
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockDbSelect.mockReturnValue(makeSelectChain([checkpoint]));

      const executor = new WorkflowExecutor(onEvent);
      const workflow = makeWorkflow([makeNode("node-a"), makeNode("node-b")], [makeEdge("node-a", "node-b")]);

      await executor.resume(10, workflow);

      // DB select was called (to look up checkpoint)
      expect(mockDbSelect).toHaveBeenCalled();
    });

    it("passes the latest checkpoint ID to executeGraph", async () => {
      const checkpoint = {
        id: 55,
        runId: 10,
        nodeId: "node-a",
        nodeOutputs: { "node-a": "output-a" },
        completedNodes: ["node-a"],
        agentSessions: {},
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockDbSelect.mockReturnValue(makeSelectChain([checkpoint]));

      const executor = new WorkflowExecutor(onEvent);
      const workflow = makeWorkflow([makeNode("node-a"), makeNode("node-b")], [makeEdge("node-a", "node-b")]);

      await executor.resume(10, workflow);

      // Wait for the fire-and-forget executeGraph to be called
      await vi.waitFor(() => expect(mockExecuteGraph).toHaveBeenCalled());

      // executeGraph called with the checkpoint ID (6th argument = resumeFromCheckpointId)
      const callArgs = mockExecuteGraph.mock.calls[0];
      expect(callArgs[0]).toBe(10); // runId
      expect(callArgs[5]).toBe(55); // resumeFromCheckpointId = checkpoint.id
    });

    it("passes undefined to executeGraph when no checkpoint exists (fresh retry)", async () => {
      // No checkpoint found
      mockDbSelect.mockReturnValue(makeSelectChain([]));

      const executor = new WorkflowExecutor(onEvent);
      const workflow = makeWorkflow([makeNode("node-a")], []);

      await executor.resume(10, workflow);

      await vi.waitFor(() => expect(mockExecuteGraph).toHaveBeenCalled());

      const callArgs = mockExecuteGraph.mock.calls[0];
      expect(callArgs[0]).toBe(10);
      // undefined checkpoint ID = fresh run from scratch
      expect(callArgs[5]).toBeUndefined();
    });

    it("emits run:started event via onEvent callback", async () => {
      mockDbSelect.mockReturnValue(makeSelectChain([]));

      const executor = new WorkflowExecutor(onEvent);
      const workflow = makeWorkflow([makeNode("node-a")], []);

      await executor.resume(7, workflow);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:started", runId: 7 })
      );
    });

    it("passes triggerNodeId from the workflow's trigger node to executeGraph", async () => {
      mockDbSelect.mockReturnValue(makeSelectChain([]));

      const triggerNode = makeNode("trigger-node", "trigger");
      const agentNode = makeNode("agent-node", "agent");
      const workflow = makeWorkflow(
        [triggerNode, agentNode],
        [makeEdge("trigger-node", "agent-node")]
      );

      const executor = new WorkflowExecutor(onEvent);
      await executor.resume(5, workflow);

      await vi.waitFor(() => expect(mockExecuteGraph).toHaveBeenCalled());

      const callArgs = mockExecuteGraph.mock.calls[0];
      // 5th argument (index 4) = triggerNodeId
      expect(callArgs[4]).toBe("trigger-node");
    });

    it("passes undefined triggerNodeId when workflow has no trigger node", async () => {
      mockDbSelect.mockReturnValue(makeSelectChain([]));

      const workflow = makeWorkflow([makeNode("node-a"), makeNode("node-b")], [makeEdge("node-a", "node-b")]);

      const executor = new WorkflowExecutor(onEvent);
      await executor.resume(5, workflow);

      await vi.waitFor(() => expect(mockExecuteGraph).toHaveBeenCalled());

      const callArgs = mockExecuteGraph.mock.calls[0];
      expect(callArgs[4]).toBeUndefined();
    });

    it("persists the run:started event to the runEvents table", async () => {
      mockDbSelect.mockReturnValue(makeSelectChain([]));

      const insertChain = makeInsertChain();
      mockDbInsert.mockReturnValue(insertChain);

      const executor = new WorkflowExecutor(onEvent);
      await executor.resume(7, makeWorkflow([makeNode("node-a")], []));

      // Allow microtasks to settle
      await Promise.resolve();

      expect(mockDbInsert).toHaveBeenCalled();
      const insertedEvent = insertChain.values.mock.calls[0]?.[0];
      expect(insertedEvent).toMatchObject({ runId: 7, type: "run:started" });
    });
  });

  // ── execute() ───────────────────────────────────────────────

  describe("execute()", () => {
    it("inserts a new run record and returns its ID", async () => {
      const insertChain = makeInsertChain([{ id: 42 }]);
      mockDbInsert.mockReturnValue(insertChain);

      const executor = new WorkflowExecutor(onEvent);
      const workflow = makeWorkflow([makeNode("node-a")], []);

      const runId = await executor.execute(workflow);

      expect(runId).toBe(42);
    });

    it("creates run with status 'running' and correct workflowId", async () => {
      const insertChain = makeInsertChain([{ id: 99 }]);
      mockDbInsert.mockReturnValue(insertChain);

      const workflow = makeWorkflow([makeNode("node-a")], []);
      // Override id to be numeric (as stored in DB)
      (workflow as WorkflowDefinition & { id: unknown }).id = 7;

      const executor = new WorkflowExecutor(onEvent);
      await executor.execute(workflow);

      const firstInsertCall = insertChain.values.mock.calls[0]?.[0];
      expect(firstInsertCall).toMatchObject({
        workflowId: 7,
        status: "running",
      });
    });

    it("emits run:started event via onEvent callback", async () => {
      const insertChain = makeInsertChain([{ id: 42 }]);
      mockDbInsert.mockReturnValue(insertChain);

      const executor = new WorkflowExecutor(onEvent);
      const workflow = makeWorkflow([makeNode("node-a")], []);

      await executor.execute(workflow);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "run:started", runId: 42 })
      );
    });

    it("calls executeGraph asynchronously with the created runId", async () => {
      const insertChain = makeInsertChain([{ id: 42 }]);
      mockDbInsert.mockReturnValue(insertChain);

      const executor = new WorkflowExecutor(onEvent);
      const workflow = makeWorkflow([makeNode("node-a")], []);

      await executor.execute(workflow);

      await vi.waitFor(() => expect(mockExecuteGraph).toHaveBeenCalled());

      const callArgs = mockExecuteGraph.mock.calls[0];
      expect(callArgs[0]).toBe(42); // runId
    });
  });
});
