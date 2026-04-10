/**
 * RED tests for node-executor.ts bugs identified in code review.
 *
 * Focus:
 * - Missing `transcript` field in filterDiscussionOutput "last" case
 * - Logic error in triggeredBy edge lookup when trigger edge is participant-only
 * - Input merging behavior for multiple edges
 */
import { describe, it, expect, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────
vi.mock("../../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports ──────────────────────────────────────────────────
import { filterDiscussionOutput, type DiscussionOutput, type SpeechRecord } from "../../node-executor";

// ── Helpers ──────────────────────────────────────────────────

function makeSpeechRecord(
  agentName: string,
  agentId: string,
  round: number,
  message: string
): SpeechRecord {
  return { agentName, agentId, round, message };
}

function makeDiscussionOutput(overrides: Partial<DiscussionOutput> = {}): DiscussionOutput {
  return {
    responses: [],
    transcript: "Sample transcript",
    moderatorSummary: null,
    rounds: 1,
    exitReason: "max_rounds",
    input: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("filterDiscussionOutput", () => {
  // ── BUG: Missing transcript in "last" case ────────────────────

  describe('BUG: "last" case missing transcript field', () => {
    it("returns object with transcript field when sourceHandle is 'last'", () => {
      const output = makeDiscussionOutput({
        responses: [
          makeSpeechRecord("AgentA", "id-a", 1, "First message"),
          makeSpeechRecord("AgentB", "id-b", 1, "Response"),
          makeSpeechRecord("AgentA", "id-a", 2, "Follow-up from A"),
        ],
        transcript: "Full conversation transcript here",
        moderatorSummary: "They discussed topic X",
        rounds: 2,
        exitReason: "max_rounds",
      });

      const result = filterDiscussionOutput(output, "last") as Record<string, unknown>;

      // This test FAILS because transcript is missing from the returned object
      expect(result).toHaveProperty("transcript", "Full conversation transcript here");
    });

    it("'last' case result includes all required DiscussionOutput fields except responses filtering", () => {
      const output = makeDiscussionOutput({
        responses: [
          makeSpeechRecord("AgentA", "id-a", 1, "Message 1"),
          makeSpeechRecord("AgentA", "id-a", 2, "Message 2"),
          makeSpeechRecord("AgentB", "id-b", 1, "Message 3"),
        ],
        transcript: "Transcript content",
        moderatorSummary: "Summary text",
        rounds: 3,
        exitReason: "end_discussion",
      });

      const result = filterDiscussionOutput(output, "last") as Record<string, unknown>;

      // Verify all DiscussionOutput contract fields are present
      expect(result).toHaveProperty("responses");
      expect(result).toHaveProperty("transcript");
      expect(result).toHaveProperty("moderatorSummary");
      expect(result).toHaveProperty("rounds");
      expect(result).toHaveProperty("exitReason");
      expect(result).toHaveProperty("input");
    });

    it("'last' case correctly keeps only last message per agent and includes transcript", () => {
      const output = makeDiscussionOutput({
        responses: [
          makeSpeechRecord("AgentA", "id-a", 1, "A first"),
          makeSpeechRecord("AgentB", "id-b", 1, "B first"),
          makeSpeechRecord("AgentA", "id-a", 2, "A second"),
          makeSpeechRecord("AgentC", "id-c", 2, "C only"),
          makeSpeechRecord("AgentB", "id-b", 2, "B second"),
        ],
        transcript: "Complete transcript with all messages",
      });

      const result = filterDiscussionOutput(output, "last") as Record<string, unknown>;

      // Should have exactly 3 responses (last from each agent)
      const responses = result.responses as SpeechRecord[];
      expect(responses).toHaveLength(3);
      expect(responses.map((r) => r.agentId).sort()).toEqual(["id-a", "id-b", "id-c"]);
      expect(responses.find((r) => r.agentId === "id-a")?.message).toBe("A second");
      expect(responses.find((r) => r.agentId === "id-b")?.message).toBe("B second");

      // And transcript should still be present
      expect(result).toHaveProperty("transcript", "Complete transcript with all messages");
    });
  });

  // ── Verify other cases still work ─────────────────────────────

  describe("filterDiscussionOutput with 'full' sourceHandle", () => {
    it("returns full output unchanged with sourceHandle 'full'", () => {
      const output = makeDiscussionOutput({
        responses: [makeSpeechRecord("A", "id-a", 1, "msg")],
        transcript: "Transcript",
        moderatorSummary: "Summary",
      });

      const result = filterDiscussionOutput(output, "full");

      expect(result).toBe(output);
    });
  });

  describe("filterDiscussionOutput with 'summary' sourceHandle", () => {
    it("returns only summary and input with sourceHandle 'summary'", () => {
      const output = makeDiscussionOutput({
        responses: [makeSpeechRecord("A", "id-a", 1, "msg")],
        transcript: "Transcript content",
        moderatorSummary: "Discussion summary here",
        input: { topic: "test" },
      });

      const result = filterDiscussionOutput(output, "summary") as Record<string, unknown>;

      expect(result).toHaveProperty("summary", "Discussion summary here");
      expect(result).toHaveProperty("input", { topic: "test" });
      expect(result).not.toHaveProperty("responses");
      expect(result).not.toHaveProperty("transcript");
      expect(result).not.toHaveProperty("rounds");
    });
  });

  describe("filterDiscussionOutput with unknown sourceHandle", () => {
    it("returns full output unchanged for unknown sourceHandle", () => {
      const output = makeDiscussionOutput({
        responses: [makeSpeechRecord("A", "id-a", 1, "msg")],
      });

      const result = filterDiscussionOutput(output, "unknown-handle");

      expect(result).toBe(output);
    });

    it("returns full output for legacy 'bottom' sourceHandle", () => {
      const output = makeDiscussionOutput({
        responses: [makeSpeechRecord("A", "id-a", 1, "msg")],
        transcript: "transcript",
      });

      const result = filterDiscussionOutput(output, "bottom");

      expect(result).toBe(output);
    });
  });

  describe("filterDiscussionOutput with non-DiscussionOutput input", () => {
    it("returns input unchanged if not a DiscussionOutput object", () => {
      const notDiscussionOutput = { some: "data" };

      const result = filterDiscussionOutput(notDiscussionOutput, "last");

      expect(result).toBe(notDiscussionOutput);
    });

    it("returns string unchanged", () => {
      const result = filterDiscussionOutput("not a discussion output", "last");

      expect(result).toBe("not a discussion output");
    });

    it("returns null unchanged", () => {
      const result = filterDiscussionOutput(null, "last");

      expect(result).toBeNull();
    });

    it("returns object without responses field unchanged", () => {
      const almostDiscussionOutput = {
        transcript: "has transcript",
        // missing responses field
      };

      const result = filterDiscussionOutput(almostDiscussionOutput, "last");

      expect(result).toBe(almostDiscussionOutput);
    });

    it("returns object without transcript field unchanged", () => {
      const almostDiscussionOutput = {
        responses: [],
        // missing transcript field
      };

      const result = filterDiscussionOutput(almostDiscussionOutput, "last");

      expect(result).toBe(almostDiscussionOutput);
    });
  });
});
