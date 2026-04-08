/**
 * Tests for node-executor.ts — specifically the discussion node case.
 *
 * Focus:
 * - Participant edges (targetHandle="participants") are excluded from input resolution
 * - triggeredBy takes precedence over incoming edges
 * - Discussion executor is called with correct arguments
 * - node:started / node:completed / node:failed events are emitted
 * - executor output stored in nodeOutputs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkflowNode, WorkflowEdge, DiscussionConfig } from "@openconclave/shared";
import type { RunEvent } from "../../types";

// ── Module mocks ─────────────────────────────────────────────

vi.mock("./discussion", () => ({
  executeDiscussion: vi.fn(),
}));

vi.mock("./agent", () => ({
  executeAgentNode: vi.fn(),
}));

vi.mock("./trigger", () => ({
  executeTrigger: vi.fn(),
}));

vi.mock("./condition", () => ({
  executeCondition: vi.fn(),
}));

vi.mock("./code", () => ({
  executeCode: vi.fn(),
}));

vi.mock("./merge", () => ({
  executeMerge: vi.fn(),
}));

vi.mock("./prompt", () => ({
  executePrompt: vi.fn(),
}));

vi.mock("./file", () => ({
  executeFile: vi.fn(),
}));

vi.mock("./output", () => ({
  executeOutput: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports after mocks ───────────────────────────────────────

import { executeNode } from "../../node-executor";
import { executeDiscussion } from "../discussion";

// ── Helpers ──────────────────────────────────────────────────

function makeDiscussionNode(id = "disc-1", maxRounds = 3): WorkflowNode {
  const config: DiscussionConfig = { prompt: "Discuss {{input}}", maxRounds };
  return {
    id,
    type: "discussion",
    position: { x: 0, y: 0 },
    data: { label: "Discussion", type: "discussion", config },
  };
}

function makeAgentNode(id: string, label = "Agent"): WorkflowNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      label,
      type: "agent",
      config: {
        engine: "claude",
        systemPrompt: "Test",
        allowedTools: [],
        mcpServers: [],
        knowledgeBases: [],
      },
    },
  };
}

function makeTriggerNode(id = "trigger-1"): WorkflowNode {
  return {
    id,
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { label: "Trigger", type: "trigger", config: { type: "manual" } },
  };
}

function makeParticipantEdge(source: string, target: string): WorkflowEdge {
  return { id: `${source}->${target}-p`, source, target, targetHandle: "participants" };
}

function makeDataEdge(source: string, target: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target };
}

function makeWorkflow(nodes: WorkflowNode[]) {
  return { id: "workflow-1", name: "Test Workflow", nodes, edges: [] };
}

function makeEmit(): { emit: (e: RunEvent) => void; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

// ── Tests ─────────────────────────────────────────────────────

describe("executeNode — discussion case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Participant edge filtering ────────────────────────────────

  describe("participant edge filtering in input resolution", () => {
    it("uses only the data-flow edge as input (not the participant edge)", async () => {
      const discNode = makeDiscussionNode();
      const agentA = makeAgentNode("agent-a", "Agent A");
      const triggerNode = makeTriggerNode();

      const edges: WorkflowEdge[] = [
        makeDataEdge("trigger-1", "disc-1"),
        makeParticipantEdge("agent-a", "disc-1"),
      ];
      const nodeMap = new Map([
        ["disc-1", discNode],
        ["agent-a", agentA],
        ["trigger-1", triggerNode],
      ]);
      const nodeOutputs = new Map<string, unknown>([
        ["trigger-1", "trigger-output"],
        ["agent-a", "agent-output"],
      ]);
      const { emit } = makeEmit();

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue({
        rounds: 0,
        exitReason: "max_rounds",
      });

      await executeNode(
        1, "disc-1", nodeMap, edges, nodeOutputs,
        new Map(), null, makeWorkflow([discNode, agentA, triggerNode]), emit,
      );

      // input arg (index 8) must be "trigger-output", not "agent-output" or an array
      const input = (executeDiscussion as ReturnType<typeof vi.fn>).mock.calls[0][8];
      expect(input).toBe("trigger-output");
    });

    it("passes undefined input when ALL incoming edges are participant edges (no data source)", async () => {
      const discNode = makeDiscussionNode();
      const agentA = makeAgentNode("agent-a", "Agent A");

      const edges: WorkflowEdge[] = [makeParticipantEdge("agent-a", "disc-1")];
      const nodeMap = new Map([["disc-1", discNode], ["agent-a", agentA]]);
      const nodeOutputs = new Map<string, unknown>([["agent-a", "agent-output"]]);
      const { emit } = makeEmit();

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue({ rounds: 0 });

      await executeNode(
        1, "disc-1", nodeMap, edges, nodeOutputs,
        new Map(), null, makeWorkflow([discNode, agentA]), emit,
      );

      const input = (executeDiscussion as ReturnType<typeof vi.fn>).mock.calls[0][8];
      // No data-flow edges → input is undefined
      expect(input).toBeUndefined();
    });

    it("uses triggeredBy output directly, ignoring edge topology", async () => {
      const discNode = makeDiscussionNode();
      const agentA = makeAgentNode("agent-a", "Agent A");
      const triggerNode = makeTriggerNode();

      const edges: WorkflowEdge[] = [
        makeDataEdge("trigger-1", "disc-1"),
        makeParticipantEdge("agent-a", "disc-1"),
      ];
      const nodeMap = new Map([
        ["disc-1", discNode],
        ["agent-a", agentA],
        ["trigger-1", triggerNode],
      ]);
      const nodeOutputs = new Map<string, unknown>([
        ["trigger-1", "trigger-output"],
        ["agent-a", "agent-output"],
      ]);
      const { emit } = makeEmit();

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue({ rounds: 1 });

      await executeNode(
        1, "disc-1", nodeMap, edges, nodeOutputs,
        new Map(), null, makeWorkflow([discNode, agentA, triggerNode]), emit,
        undefined,   // triggerPayload
        "trigger-1", // triggeredBy
      );

      const input = (executeDiscussion as ReturnType<typeof vi.fn>).mock.calls[0][8];
      expect(input).toBe("trigger-output");
    });

    it("does NOT include participant agent output in multi-source fan-in", async () => {
      const discNode = makeDiscussionNode();
      const agentA = makeAgentNode("agent-a", "Agent A");
      const triggerNode = makeTriggerNode();
      const transformNode: WorkflowNode = {
        id: "transform-1",
        type: "transform",
        position: { x: 0, y: 0 },
        data: { label: "Transform", type: "transform", config: { runtime: "node", code: "" } },
      };

      // Two real data edges + one participant edge
      const edges: WorkflowEdge[] = [
        makeDataEdge("trigger-1", "disc-1"),
        makeDataEdge("transform-1", "disc-1"),
        makeParticipantEdge("agent-a", "disc-1"),
      ];
      const nodeMap = new Map([
        ["disc-1", discNode],
        ["agent-a", agentA],
        ["trigger-1", triggerNode],
        ["transform-1", transformNode],
      ]);
      const nodeOutputs = new Map<string, unknown>([
        ["trigger-1", "from-trigger"],
        ["transform-1", "from-transform"],
        ["agent-a", "from-agent"],
      ]);
      const { emit } = makeEmit();

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue({ rounds: 0 });

      await executeNode(
        1, "disc-1", nodeMap, edges, nodeOutputs,
        new Map(), null, makeWorkflow([discNode, agentA, triggerNode, transformNode]), emit,
      );

      const input = (executeDiscussion as ReturnType<typeof vi.fn>).mock.calls[0][8];
      // Should be array of data-flow sources only, no participant
      expect(Array.isArray(input)).toBe(true);
      const inputArr = input as unknown[];
      expect(inputArr).toContain("from-trigger");
      expect(inputArr).toContain("from-transform");
      expect(inputArr).not.toContain("from-agent");
    });
  });

  // ── Call signature ────────────────────────────────────────────

  describe("executor call signature", () => {
    it("passes runId, nodeId, node, nodeMap, edges to executeDiscussion", async () => {
      const discNode = makeDiscussionNode();
      const nodeMap = new Map([["disc-1", discNode]]);
      const edges: WorkflowEdge[] = [];
      const nodeOutputs = new Map<string, unknown>();
      const { emit } = makeEmit();

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue({ rounds: 0 });

      await executeNode(
        42, "disc-1", nodeMap, edges, nodeOutputs,
        new Map(), null, makeWorkflow([discNode]), emit,
      );

      const callArgs = (executeDiscussion as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe(42);          // runId
      expect(callArgs[1]).toBe("disc-1");   // nodeId
      expect(callArgs[2]).toBe(discNode);   // node
      expect(callArgs[3]).toBe(nodeMap);    // nodeMap
      expect(callArgs[4]).toBe(edges);      // edges
    });
  });

  // ── Event emission ────────────────────────────────────────────

  describe("event emission", () => {
    it("emits node:started before the discussion executor is called", async () => {
      const discNode = makeDiscussionNode();
      const nodeMap = new Map([["disc-1", discNode]]);
      const { emit, events } = makeEmit();

      let startedBeforeCall = false;
      (executeDiscussion as ReturnType<typeof vi.fn>).mockImplementation(() => {
        startedBeforeCall = events.some((e) => e.type === "node:started");
        return Promise.resolve({ rounds: 0 });
      });

      await executeNode(
        1, "disc-1", nodeMap, [], new Map(),
        new Map(), null, makeWorkflow([discNode]), emit,
      );

      expect(startedBeforeCall).toBe(true);
    });

    it("emits node:completed with the executor's return value as data", async () => {
      const discNode = makeDiscussionNode();
      const nodeMap = new Map([["disc-1", discNode]]);
      const { emit, events } = makeEmit();
      const expectedOutput = { rounds: 3, exitReason: "max_rounds", responses: [] };

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue(expectedOutput);

      await executeNode(
        1, "disc-1", nodeMap, [], new Map(),
        new Map(), null, makeWorkflow([discNode]), emit,
      );

      const completedEvent = events.find((e) => e.type === "node:completed");
      expect(completedEvent).toBeDefined();
      expect(completedEvent!.data).toBe(expectedOutput);
    });

    it("emits node:failed and rethrows when executeDiscussion throws", async () => {
      const discNode = makeDiscussionNode();
      const nodeMap = new Map([["disc-1", discNode]]);
      const { emit, events } = makeEmit();
      const boom = new Error("Discussion exploded");

      (executeDiscussion as ReturnType<typeof vi.fn>).mockRejectedValue(boom);

      await expect(
        executeNode(
          1, "disc-1", nodeMap, [], new Map(),
          new Map(), null, makeWorkflow([discNode]), emit,
        ),
      ).rejects.toThrow("Discussion exploded");

      const failedEvent = events.find((e) => e.type === "node:failed");
      expect(failedEvent).toBeDefined();
      expect((failedEvent!.data as Record<string, unknown>).error).toBe("Discussion exploded");
    });

    it("emits node:started and node:completed with correct runId and nodeId", async () => {
      const discNode = makeDiscussionNode();
      const nodeMap = new Map([["disc-1", discNode]]);
      const { emit, events } = makeEmit();

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue({ rounds: 0 });

      await executeNode(
        77, "disc-1", nodeMap, [], new Map(),
        new Map(), null, makeWorkflow([discNode]), emit,
      );

      const started = events.find((e) => e.type === "node:started")!;
      const completed = events.find((e) => e.type === "node:completed")!;
      expect(started.runId).toBe(77);
      expect(started.nodeId).toBe("disc-1");
      expect(completed.runId).toBe(77);
      expect(completed.nodeId).toBe("disc-1");
    });
  });

  // ── Output storage ────────────────────────────────────────────

  describe("output storage", () => {
    it("stores the executor return value in nodeOutputs under nodeId", async () => {
      const discNode = makeDiscussionNode();
      const nodeMap = new Map([["disc-1", discNode]]);
      const nodeOutputs = new Map<string, unknown>();
      const { emit } = makeEmit();
      const output = { rounds: 2, exitReason: "end_discussion" };

      (executeDiscussion as ReturnType<typeof vi.fn>).mockResolvedValue(output);

      await executeNode(
        1, "disc-1", nodeMap, [], nodeOutputs,
        new Map(), null, makeWorkflow([discNode]), emit,
      );

      expect(nodeOutputs.get("disc-1")).toBe(output);
    });

    it("does not store output when execution fails", async () => {
      const discNode = makeDiscussionNode();
      const nodeMap = new Map([["disc-1", discNode]]);
      const nodeOutputs = new Map<string, unknown>();
      const { emit } = makeEmit();

      (executeDiscussion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

      await expect(
        executeNode(
          1, "disc-1", nodeMap, [], nodeOutputs,
          new Map(), null, makeWorkflow([discNode]), emit,
        ),
      ).rejects.toThrow();

      expect(nodeOutputs.has("disc-1")).toBe(false);
    });
  });
});
