import { describe, test, expect } from "bun:test";
import type { ConclaveDefinition, ConclaveEdge, ConclaveNode } from "@openconclave/shared";
import { executeNode } from "../node-executor";
import { Workspace } from "../workspace";
import type { RunEvent } from "../types";

function makeNode(
  id: string,
  type: ConclaveNode["data"]["type"],
  label = id,
  config: Record<string, unknown> = {},
): ConclaveNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label, type, config: config as never },
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
): ConclaveEdge {
  return { id, source, target, sourceHandle };
}

function makeConclave(nodes: ConclaveNode[], edges: ConclaveEdge[]): ConclaveDefinition {
  return {
    id: "c1",
    name: "test",
    nodes,
    edges,
    enabled: true,
    createdAt: "",
    updatedAt: "",
  };
}

// ── MAJOR: merge with two handles from same discussion source ─────────────────

describe("executeNode — merge with two edges from the same discussion source (MAJOR)", () => {
  test("'full' and 'summary' edges produce DISTINCT filtered values, not the last-write-wins value", async () => {
    const discussion = makeNode("D", "discussion");
    const merge = makeNode("M", "merge");
    const nodes = [discussion, merge];
    const edges = [
      makeEdge("e_full", "D", "M", "full"),
      makeEdge("e_summary", "D", "M", "summary"),
    ];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const discussionOutput = {
      responses: [
        { agentId: "a1", agentName: "A", round: 1, message: "hello" },
        { agentId: "a2", agentName: "B", round: 1, message: "world" },
      ],
      transcript: "[Round 1] A: hello\n[Round 1] B: world",
      moderatorSummary: "they agreed",
      rounds: 1,
      exitReason: "max_rounds",
      input: null,
    };
    const nodeOutputs = new Map<string, unknown>([["D", discussionOutput]]);

    const events: RunEvent[] = [];
    const emit = (e: RunEvent) => { events.push(e); };

    const output = (await executeNode(
      1,
      "M",
      nodeMap,
      edges,
      nodeOutputs,
      new Map(),
      null,
      makeConclave(nodes, edges),
      emit,
      undefined,
      null,
      undefined,
      new Workspace(),
    )) as Record<string, unknown>;

    const fullVal = output["D:full"] as Record<string, unknown>;
    const summaryVal = output["D:summary"] as Record<string, unknown>;

    expect(fullVal).toBeDefined();
    expect((fullVal as { transcript?: string }).transcript).toBe(
      "[Round 1] A: hello\n[Round 1] B: world",
    );
    expect((fullVal as { responses?: unknown[] }).responses).toHaveLength(2);

    expect(summaryVal).toBeDefined();
    expect((summaryVal as { summary?: string }).summary).toBe("they agreed");
    expect((summaryVal as { transcript?: string }).transcript).toBeUndefined();
    expect((summaryVal as { responses?: unknown[] }).responses).toBeUndefined();
  });
});

// ── MINOR: triggeredByEdgeId absent → no-filter (was: source-based fallback) ──

describe("executeNode — triggeredByEdgeId absent (MINOR)", () => {
  test("returns raw discussion output when triggeredByEdgeId is undefined and multiple handles exist", async () => {
    const discussion = makeNode("D", "discussion");
    // 'output' node with type 'log' returns its input verbatim, so we can read
    // the resolved `input` value through nodeOutputs.get("T") after execution.
    const target = makeNode("T", "output", "T", { type: "log" });
    const nodes = [discussion, target];
    // Two edges from D to T with different handles. With the old source-based
    // fallback, find-by-source would pick the first edge ("summary") and apply
    // summary filtering to the input. The fix replaces the fallback with
    // undefined → no filtering → raw discussion payload reaches T.
    const edges = [
      makeEdge("e_summary", "D", "T", "summary"),
      makeEdge("e_full", "D", "T", "full"),
    ];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const discussionOutput = {
      responses: [{ agentId: "a1", agentName: "A", round: 1, message: "hi" }],
      transcript: "[Round 1] A: hi",
      moderatorSummary: "summary-text",
      rounds: 1,
      exitReason: "max_rounds",
      input: null,
    };
    const nodeOutputs = new Map<string, unknown>([["D", discussionOutput]]);

    const events: RunEvent[] = [];
    const emit = (e: RunEvent) => { events.push(e); };

    const output = await executeNode(
      1,
      "T",
      nodeMap,
      edges,
      nodeOutputs,
      new Map(),
      null,
      makeConclave(nodes, edges),
      emit,
      undefined,
      "D",
      undefined,
      new Workspace(),
    );

    // executeOutput returns input verbatim → output IS the resolved input.
    // With the fallback fix, this MUST be the raw discussion payload, not the
    // summary-only filtered shape.
    const o = output as Record<string, unknown>;
    expect(o.transcript).toBe("[Round 1] A: hi");
    expect(o.responses).toBeDefined();
    expect((o.responses as unknown[]).length).toBe(1);
    expect(o.moderatorSummary).toBe("summary-text");
    expect(o.summary).toBeUndefined();
  });
});
