import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkflowNode, WorkflowEdge, DiscussionConfig } from "@openconclave/shared";
import type { RunEvent } from "../types";

// ── Module mocks (must be hoisted) ───────────────────────────

vi.mock("../../db/client", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../../db/schema", () => ({
  runs: {},
}));

vi.mock("../agent-executor", () => ({
  executeAgent: vi.fn(),
}));

vi.mock("../../agent/llm-call", () => ({
  invokeWithTools: vi.fn(),
}));

vi.mock("./code", () => ({
  executeCode: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks) ─────────────────────────────────────

import { executeDiscussion } from "./discussion";

import { db } from "../../db/client";
import { executeAgent } from "../agent-executor";
import { invokeWithTools } from "../../agent/llm-call";
import { executeCode } from "./code";

// ── Helpers ──────────────────────────────────────────────────

function makeAgentNode(id: string, label: string): WorkflowNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      label,
      type: "agent",
      config: {
        engine: "claude",
        systemPrompt: "You are helpful.",
        allowedTools: [],
        mcpServers: [],
        knowledgeBases: [],
      },
    },
  };
}

function makeDiscussionNode(config: DiscussionConfig): WorkflowNode {
  return {
    id: "discussion-1",
    type: "discussion",
    position: { x: 0, y: 0 },
    data: {
      label: "My Discussion",
      type: "discussion",
      config,
    },
  };
}

function makeParticipantEdge(agentId: string, discussionId = "discussion-1"): WorkflowEdge {
  return {
    id: `${agentId}->${discussionId}`,
    source: agentId,
    target: discussionId,
    targetHandle: "participants",
  };
}

function makeDataEdge(source: string, target: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target };
}

function makeNodeMap(...nodes: WorkflowNode[]): Map<string, WorkflowNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** Default run DB mock: returns active run (not cancelled) */
function mockRunActive() {
  const dbMock = db as unknown as { select: ReturnType<typeof vi.fn> };
  dbMock.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 1, status: "running" }]),
    }),
  });
}

/** Mocks DB to return cancelled run starting on the Nth call (1-indexed) */
function mockRunCancelledOnCall(callIndex: number) {
  const dbMock = db as unknown as { select: ReturnType<typeof vi.fn> };
  let callCount = 0;
  dbMock.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        callCount++;
        const status = callCount >= callIndex ? "cancelled" : "running";
        return Promise.resolve([{ id: 1, status }]);
      }),
    }),
  }));
}

/** Mock executeAgent to return a fixed message */
function mockAgent(message: string) {
  (executeAgent as ReturnType<typeof vi.fn>).mockResolvedValue({ output: message });
}

/** Collects emitted events */
function makeEmit(): { emit: (e: RunEvent) => void; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

// ── Tests ─────────────────────────────────────────────────────

describe("executeDiscussion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── No participants ──────────────────────────────────────────

  describe("no participants", () => {
    it("emits discussion:started then discussion:completed with exitReason=no_participants", async () => {
      const discussionNode = makeDiscussionNode({ prompt: "Discuss {{input}}", maxRounds: 3 });
      const nodeMap = makeNodeMap(discussionNode);
      const edges: WorkflowEdge[] = []; // no participant edges
      const { emit, events } = makeEmit();

      const result = await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, "hello", emit,
      );

      expect(events[0].type).toBe("discussion:started");
      expect(events[1].type).toBe("discussion:completed");
      expect((events[1].data as Record<string, unknown>).exitReason).toBe("no_participants");
      expect((result as Record<string, unknown>).rounds).toBe(0);
      expect((result as Record<string, unknown>).exitReason).toBe("no_participants");
    });

    it("returns empty responses and empty transcript when no participants", async () => {
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 5 });
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode), [],
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.responses).toEqual([]);
      expect(result.transcript).toBe("");
      expect(result.moderatorSummary).toBeUndefined();
    });

    it("does NOT call executeAgent when no participants", async () => {
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 3 });
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode), [],
        new Map(), new Map(), null, null, emit,
      );

      expect(executeAgent).not.toHaveBeenCalled();
    });

    it("ignores edges that are NOT to the participants handle", async () => {
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 3 });
      const agentNode = makeAgentNode("agent-a", "Agent A");
      // data-flow edge, not a participant edge
      const dataEdge = makeDataEdge("agent-a", "discussion-1");
      const nodeMap = makeNodeMap(discussionNode, agentNode);
      const { emit, events } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, [dataEdge],
        new Map(), new Map(), null, "topic", emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("no_participants");
      expect((events[1].data as Record<string, unknown>).exitReason).toBe("no_participants");
    });
  });

  // ── max_rounds exit ──────────────────────────────────────────

  describe("max_rounds exit", () => {
    it("runs exactly maxRounds speeches and exits with exitReason=max_rounds", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Round {{round}}: speak!", maxRounds: 3 });
      const edges = [makeParticipantEdge("agent-a")];
      const nodeMap = makeNodeMap(discussionNode, agentA);
      mockRunActive();
      mockAgent("My response");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, "topic", emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("max_rounds");
      expect(result.rounds).toBe(3);
      expect((result.responses as unknown[]).length).toBe(3);
      expect(executeAgent).toHaveBeenCalledTimes(3);
    });

    it("rounds field equals number of completed speeches (not maxRounds + 1)", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 2 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      const { emit, events } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.rounds).toBe(2);
      expect((events.at(-1)!.data as Record<string, unknown>).rounds).toBe(2);
    });

    it("cycles round-robin through multiple participants", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const agentB = makeAgentNode("agent-b", "Agent B");
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 4 });
      const edges = [makeParticipantEdge("agent-a"), makeParticipantEdge("agent-b")];
      const nodeMap = makeNodeMap(discussionNode, agentA, agentB);
      mockRunActive();

      let callIdx = 0;
      const agentCalls: string[] = [];
      (executeAgent as ReturnType<typeof vi.fn>).mockImplementation(
        (_runId: number, nodeId: string) => {
          agentCalls.push(nodeId);
          return Promise.resolve({ output: `response-${callIdx++}` });
        },
      );

      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      );

      expect(agentCalls).toEqual(["agent-a", "agent-b", "agent-a", "agent-b"]);
    });

    it("emits discussion:speech for each round with correct data", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Speak", maxRounds: 2 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("Hello!");
      const { emit, events } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, "input data", emit,
      );

      const speechEvents = events.filter((e) => e.type === "discussion:speech");
      expect(speechEvents).toHaveLength(2);
      expect((speechEvents[0].data as Record<string, unknown>).agentName).toBe("Agent A");
      expect((speechEvents[0].data as Record<string, unknown>).round).toBe(1);
      expect((speechEvents[0].data as Record<string, unknown>).message).toBe("Hello!");
      expect((speechEvents[1].data as Record<string, unknown>).round).toBe(2);
    });

    it("includes input in returned output", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 1 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("ok");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, { topic: "cats" }, emit,
      )) as Record<string, unknown>;

      expect(result.input).toEqual({ topic: "cats" });
    });
  });

  // ── Cancellation ─────────────────────────────────────────────

  describe("cancellation", () => {
    it("exits with exitReason=cancelled when run is cancelled before a round", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Speak", maxRounds: 5 });
      const edges = [makeParticipantEdge("agent-a")];
      const nodeMap = makeNodeMap(discussionNode, agentA);

      // Cancel on the very first DB check (before round 1)
      mockRunCancelledOnCall(1);
      mockAgent("response");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("cancelled");
    });

    it("rounds count reflects only completed speeches when cancelled mid-discussion", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Speak", maxRounds: 10 });
      const edges = [makeParticipantEdge("agent-a")];
      const nodeMap = makeNodeMap(discussionNode, agentA);

      // Allow rounds 1 and 2 to complete, cancel before round 3
      mockRunCancelledOnCall(3);
      mockAgent("speech");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      // Cancelled BEFORE round 3 speech → 2 completed speeches
      expect(result.exitReason).toBe("cancelled");
      expect(result.rounds).toBe(2);
    });
  });

  // ── Template rendering ───────────────────────────────────────

  describe("prompt template rendering", () => {
    it("renders {{agentName}} in the prompt passed to executeAgent", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({
        prompt: "Hi {{agentName}}, discuss!",
        maxRounds: 1,
      });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("response");
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      const callArgs = (executeAgent as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[3]).toBe("Hi Agent A, discuss!");
    });

    it("renders {{round}} with incrementing values across rounds", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({
        prompt: "Round {{round}}",
        maxRounds: 2,
      });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("ok");
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      expect((executeAgent as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe("Round 1");
      expect((executeAgent as ReturnType<typeof vi.fn>).mock.calls[1][3]).toBe("Round 2");
    });

    it("renders {{input.topic}} via dot notation", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({
        prompt: "Topic: {{input.topic}}",
        maxRounds: 1,
      });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("ok");
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, { topic: "Space" }, emit,
      );

      expect((executeAgent as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe("Topic: Space");
    });

    it("builds cumulative transcript passed to subsequent rounds", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({
        prompt: "Transcript so far: {{transcript}}",
        maxRounds: 2,
      });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      (executeAgent as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ output: "First speech" })
        .mockResolvedValueOnce({ output: "Second speech" });
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      // Round 1: transcript is empty
      expect((executeAgent as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe(
        "Transcript so far: ",
      );
      // Round 2: transcript contains round 1 speech
      expect((executeAgent as ReturnType<typeof vi.fn>).mock.calls[1][3]).toContain(
        "[Round 1] Agent A: First speech",
      );
    });
  });

  // ── Responses shape ──────────────────────────────────────────

  describe("responses array shape", () => {
    it("each response record has agentName, agentId, round, message", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 2 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("the answer");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as { responses: Array<Record<string, unknown>> };

      expect(result.responses[0]).toMatchObject({
        agentName: "Agent A",
        agentId: "agent-a",
        round: 1,
        message: "the answer",
      });
      expect(result.responses[1]).toMatchObject({ round: 2 });
    });
  });

  // ── Participant agent tool stripping ─────────────────────────

  describe("participant tool stripping", () => {
    it("calls executeAgent with empty allowedTools, mcpServers, knowledgeBases regardless of agent config", async () => {
      const agentA: WorkflowNode = {
        id: "agent-a",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: "Agent A",
          type: "agent",
          config: {
            engine: "claude",
            systemPrompt: "Test",
            allowedTools: ["Bash", "Read"],
            mcpServers: [{ id: "mcp-1", url: "http://mcp", name: "MCP" }],
            knowledgeBases: [7],
          },
        },
      };
      const discussionNode = makeDiscussionNode({ prompt: "Go", maxRounds: 1 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("ok");
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      const resolvedConfig = (executeAgent as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(resolvedConfig.allowedTools).toEqual([]);
      expect(resolvedConfig.mcpServers).toEqual([]);
      expect(resolvedConfig.knowledgeBases).toEqual([]);
    });
  });

  // ── Code moderator ───────────────────────────────────────────

  describe("code moderator", () => {
    const codeModeratorConfig = {
      type: "code" as const,
      node: {
        label: "Moderator",
        type: "transform" as const,
        config: { runtime: "node", code: "return {action:'call_next'}" },
      },
    };

    it("calls executeCode with the transcript, responses, round, and input", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ action: "call_next" });
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, "input-value", emit,
      );

      expect(executeCode).toHaveBeenCalledOnce();
      const codeInput = (executeCode as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(codeInput).toMatchObject({
        responses: expect.any(Array),
        round: 1,
        input: "input-value",
      });
      expect(typeof (codeInput as Record<string, unknown>).transcript).toBe("string");
    });

    it("exits with end_discussion when moderator returns that action", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 5,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("final speech");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ action: "end_discussion", summary: "Done!" });
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("end_discussion");
      expect(result.rounds).toBe(1); // only 1 round completed before end_discussion
      expect(result.moderatorSummary).toBe("Done!");
    });

    it("defaults to call_next when code moderator returns invalid action string", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const agentB = makeAgentNode("agent-b", "Agent B");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 2,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a"), makeParticipantEdge("agent-b")];
      const nodeMap = makeNodeMap(discussionNode, agentA, agentB);
      mockRunActive();
      mockAgent("response");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ action: "unknown_action" });
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      // Should complete all 2 rounds (call_next continues round-robin)
      expect(result.rounds).toBe(2);
      expect(result.exitReason).toBe("max_rounds");
    });

    it("defaults to call_next and does NOT throw when code moderator throws", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 2,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("response");
      (executeCode as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Code crashed"));
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      // Must not propagate the error — defaults to call_next, completes maxRounds
      expect(result.rounds).toBe(2);
      expect(result.exitReason).toBe("max_rounds");
    });

    it("defaults to call_next when code moderator returns null", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("response");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("max_rounds");
    });

    it("defaults to call_next when code moderator returns a plain string (not an object)", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("response");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue("end_discussion");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("max_rounds");
    });

    it("defaults to call_next when code moderator returns an array", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("response");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue(["end_discussion"]);
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("max_rounds");
    });

    it("handles call_specific to select a named participant by node ID", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const agentB = makeAgentNode("agent-b", "Agent B");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 3,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a"), makeParticipantEdge("agent-b")];
      const nodeMap = makeNodeMap(discussionNode, agentA, agentB);
      mockRunActive();

      const agentCalls: string[] = [];
      (executeAgent as ReturnType<typeof vi.fn>).mockImplementation(
        (_runId: number, nodeId: string) => {
          agentCalls.push(nodeId);
          return Promise.resolve({ output: "response" });
        },
      );

      // Round 1 = agent-a; moderator picks agent-b; round 2 = agent-b; moderator picks agent-b again; round 3 = agent-b; end
      (executeCode as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ action: "call_specific", nextAgent: "agent-b" })
        .mockResolvedValueOnce({ action: "call_specific", nextAgent: "agent-b" })
        .mockResolvedValueOnce({ action: "end_discussion" });

      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(agentCalls[0]).toBe("agent-a"); // initial
      expect(agentCalls[1]).toBe("agent-b"); // call_specific
      expect(agentCalls[2]).toBe("agent-b"); // call_specific again
      expect(result.exitReason).toBe("end_discussion");
    });

    it("handles call_specific by participant label", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const agentB = makeAgentNode("agent-b", "Agent B");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 2,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a"), makeParticipantEdge("agent-b")];
      const nodeMap = makeNodeMap(discussionNode, agentA, agentB);
      mockRunActive();

      const agentCalls: string[] = [];
      (executeAgent as ReturnType<typeof vi.fn>).mockImplementation(
        (_runId: number, nodeId: string) => {
          agentCalls.push(nodeId);
          return Promise.resolve({ output: "response" });
        },
      );

      // Use label instead of ID
      (executeCode as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ action: "call_specific", nextAgent: "Agent B" })
        .mockResolvedValueOnce({ action: "call_next" });

      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      );

      expect(agentCalls[0]).toBe("agent-a");
      expect(agentCalls[1]).toBe("agent-b"); // resolved by label
    });

    it("falls back to round-robin when call_specific names an unknown agent", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const agentB = makeAgentNode("agent-b", "Agent B");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 2,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a"), makeParticipantEdge("agent-b")];
      const nodeMap = makeNodeMap(discussionNode, agentA, agentB);
      mockRunActive();
      mockAgent("response");

      const agentCalls: string[] = [];
      (executeAgent as ReturnType<typeof vi.fn>).mockImplementation(
        (_runId: number, nodeId: string) => {
          agentCalls.push(nodeId);
          return Promise.resolve({ output: "response" });
        },
      );

      (executeCode as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ action: "call_specific", nextAgent: "nonexistent-agent" })
        .mockResolvedValueOnce({ action: "call_next" });

      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      );

      // Round 1 = agent-a; unknown → fallback advance round-robin → agent-b
      expect(agentCalls[0]).toBe("agent-a");
      expect(agentCalls[1]).toBe("agent-b");
    });

    it("truncates transcript to TRANSCRIPT_MAX_BYTES (100_000) before passing to code moderator", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();

      // Long message to force transcript truncation
      const longMessage = "x".repeat(200_000);
      mockAgent(longMessage);
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ action: "call_next" });
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      const codeInput = (executeCode as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const transcript = codeInput.transcript as string;
      expect(transcript.length).toBeLessThanOrEqual(100_000);
    });

    it("emits discussion:moderator event with action and summary", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: codeModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: "end_discussion",
        summary: "All done",
      });
      const { emit, events } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      const modEvent = events.find((e) => e.type === "discussion:moderator");
      expect(modEvent).toBeDefined();
      expect((modEvent!.data as Record<string, unknown>).action).toBe("end_discussion");
      expect((modEvent!.data as Record<string, unknown>).summary).toBe("All done");
    });
  });

  // ── Agent moderator ──────────────────────────────────────────

  describe("agent moderator", () => {
    const agentModeratorConfig = {
      type: "agent" as const,
      node: {
        label: "ModeratorAgent",
        type: "agent" as const,
        config: {
          engine: "claude",
          systemPrompt: "Moderate",
          allowedTools: [],
          mcpServers: [],
          knowledgeBases: [],
        },
      },
    };

    it("calls invokeWithTools with a 'moderate' tool definition", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: agentModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (invokeWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        output: "some text",
        tool_call: { name: "moderate", input: { action: "call_next" } },
      });
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      expect(invokeWithTools).toHaveBeenCalledOnce();
      const callArgs = (invokeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe("moderate");
    });

    it("defaults to call_next when agent moderator returns no tool_call (text response)", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: agentModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (invokeWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        output: "I think we should continue.",
        // no tool_call
      });
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("max_rounds");
    });

    it("ends discussion when agent moderator tool_call returns end_discussion", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 5,
        moderator: agentModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (invokeWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        output: "ending",
        tool_call: {
          name: "moderate",
          input: { action: "end_discussion", summary: "Consensus reached" },
        },
      });
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("end_discussion");
      expect(result.rounds).toBe(1);
      expect(result.moderatorSummary).toBe("Consensus reached");
    });

    it("accumulates last non-empty moderator summary across rounds", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 3,
        moderator: agentModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (invokeWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          output: "r1",
          tool_call: { name: "moderate", input: { action: "call_next", summary: "First summary" } },
        })
        .mockResolvedValueOnce({
          output: "r2",
          tool_call: { name: "moderate", input: { action: "call_next" } }, // no summary
        })
        .mockResolvedValueOnce({
          output: "r3",
          tool_call: {
            name: "moderate",
            input: { action: "end_discussion", summary: "Final summary" },
          },
        });
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.moderatorSummary).toBe("Final summary");
    });

    it("defaults to call_next when agent moderator tool_call has invalid action", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: agentModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (invokeWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        output: "r",
        tool_call: { name: "moderate", input: { action: "stop_everything" } },
      });
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.exitReason).toBe("max_rounds");
    });

    it("truncates transcript at TRANSCRIPT_MAX_BYTES before passing to agent moderator", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Discuss",
        maxRounds: 1,
        moderator: agentModeratorConfig,
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("x".repeat(200_000));
      (invokeWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        output: "ok",
        tool_call: { name: "moderate", input: { action: "call_next" } },
      });
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      const callArgs = (invokeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = callArgs.prompt as string;
      // The prompt contains the truncated transcript — total prompt length includes
      // the preamble text too, so we check the passed transcript stays bounded
      expect(prompt.length).toBeLessThanOrEqual(100_000 + 200); // some preamble overhead
    });
  });

  // ── No moderator (pure round-robin) ──────────────────────────

  describe("no moderator", () => {
    it("does not call executeCode or invokeWithTools", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 2 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("ok");
      const { emit } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      expect(executeCode).not.toHaveBeenCalled();
      expect(invokeWithTools).not.toHaveBeenCalled();
    });
  });

  // ── Participant node type filtering ──────────────────────────

  describe("participant node type filtering", () => {
    it("ignores non-agent nodes connected via the participants handle", async () => {
      // A transform node that wrongly has a participant edge
      const transformNode: WorkflowNode = {
        id: "transform-1",
        type: "transform",
        position: { x: 0, y: 0 },
        data: {
          label: "Transform",
          type: "transform",
          config: { runtime: "node", code: "return input" },
        },
      };
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 1 });
      const edges = [makeParticipantEdge("transform-1")];
      const nodeMap = makeNodeMap(discussionNode, transformNode);
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, nodeMap, edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      // transform node is not type "agent" → filtered out → no participants
      expect(result.exitReason).toBe("no_participants");
      expect(executeAgent).not.toHaveBeenCalled();
    });
  });

  // ── Event sequence ───────────────────────────────────────────

  describe("event sequence", () => {
    it("discussion:started is first, discussion:completed is last", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Go", maxRounds: 2 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      const { emit, events } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      const types = events.map((e) => e.type);
      expect(types[0]).toBe("discussion:started");
      expect(types.at(-1)).toBe("discussion:completed");
      expect(types.filter((t) => t === "discussion:speech")).toHaveLength(2);
    });

    it("discussion:started includes participant names, moderatorType=null, and maxRounds", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const agentB = makeAgentNode("agent-b", "Agent B");
      const discussionNode = makeDiscussionNode({ prompt: "Go", maxRounds: 10 });
      const edges = [makeParticipantEdge("agent-a"), makeParticipantEdge("agent-b")];
      mockRunActive();
      mockAgent("speech");
      const { emit, events } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode,
        makeNodeMap(discussionNode, agentA, agentB), edges,
        new Map(), new Map(), null, null, emit,
      );

      const startEvent = events[0];
      expect((startEvent.data as Record<string, unknown>).participants).toContain("Agent A");
      expect((startEvent.data as Record<string, unknown>).participants).toContain("Agent B");
      expect((startEvent.data as Record<string, unknown>).maxRounds).toBe(10);
      expect((startEvent.data as Record<string, unknown>).moderatorType).toBeNull();
    });

    it("discussion:started includes correct moderatorType when moderator is set", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const config: DiscussionConfig = {
        prompt: "Go",
        maxRounds: 1,
        moderator: {
          type: "code",
          node: {
            label: "Mod",
            type: "transform",
            config: { runtime: "node", code: "return {action:'end_discussion'}" },
          },
        },
      };
      const discussionNode = makeDiscussionNode(config);
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      (executeCode as ReturnType<typeof vi.fn>).mockResolvedValue({ action: "end_discussion" });
      const { emit, events } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      expect((events[0].data as Record<string, unknown>).moderatorType).toBe("code");
    });

    it("discussion:completed responseCount matches rounds on max_rounds exit", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Go", maxRounds: 3 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      const { emit, events } = makeEmit();

      await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      const completedEvent = events.at(-1)!;
      expect((completedEvent.data as Record<string, unknown>).rounds).toBe(3);
      expect((completedEvent.data as Record<string, unknown>).responseCount).toBe(3);
    });

    it("all events carry correct runId and nodeId", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Go", maxRounds: 1 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("speech");
      const { emit, events } = makeEmit();

      await executeDiscussion(
        99, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      );

      for (const event of events) {
        expect(event.runId).toBe(99);
        expect(event.nodeId).toBe("discussion-1");
      }
    });
  });

  // ── Boundary: maxRounds = 1 ───────────────────────────────────

  describe("boundary conditions", () => {
    it("works correctly with maxRounds=1 (single speech)", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Speak once", maxRounds: 1 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("single response");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.rounds).toBe(1);
      expect(result.exitReason).toBe("max_rounds");
      expect(executeAgent).toHaveBeenCalledOnce();
    });

    it("handles a single participant with maxRounds=10 without errors", async () => {
      const agentA = makeAgentNode("agent-a", "Agent A");
      const discussionNode = makeDiscussionNode({ prompt: "Discuss", maxRounds: 10 });
      const edges = [makeParticipantEdge("agent-a")];
      mockRunActive();
      mockAgent("round response");
      const { emit } = makeEmit();

      const result = (await executeDiscussion(
        1, "discussion-1", discussionNode, makeNodeMap(discussionNode, agentA), edges,
        new Map(), new Map(), null, null, emit,
      )) as Record<string, unknown>;

      expect(result.rounds).toBe(10);
      expect(executeAgent).toHaveBeenCalledTimes(10);
    });
  });
});
