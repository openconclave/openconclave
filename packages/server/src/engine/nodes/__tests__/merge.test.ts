import { describe, it, expect } from "vitest";
import { executeMerge } from "../merge";
import type { WorkflowNode, WorkflowEdge } from "@openconclave/shared";

// ── Helpers ──────────────────────────────────────────────────

function makeNode(id: string, label: string, type = "agent"): WorkflowNode {
  return {
    id,
    type: type as WorkflowNode["type"],
    position: { x: 0, y: 0 },
    data: { label, type: type as WorkflowNode["type"], config: {} },
  };
}

function makeEdge(source: string, target: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target };
}

// ── Tests ─────────────────────────────────────────────────────

describe("executeMerge", () => {
  // ── Happy path ───────────────────────────────────────────────

  describe("happy path", () => {
    it("merges two inputs into an object keyed by source node labels", () => {
      const mergeNodeId = "merge-1";
      const edges: WorkflowEdge[] = [
        makeEdge("agent-a", mergeNodeId),
        makeEdge("agent-b", mergeNodeId),
      ];
      const nodeMap = new Map<string, WorkflowNode>([
        ["agent-a", makeNode("agent-a", "Agent A")],
        ["agent-b", makeNode("agent-b", "Agent B")],
      ]);
      const nodeOutputs = new Map<string, unknown>([
        ["agent-a", "output from A"],
        ["agent-b", "output from B"],
      ]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toEqual({
        "Agent A": "output from A",
        "Agent B": "output from B",
      });
    });

    it("merges three inputs", () => {
      const mergeNodeId = "merge-1";
      const edges: WorkflowEdge[] = [
        makeEdge("n1", mergeNodeId),
        makeEdge("n2", mergeNodeId),
        makeEdge("n3", mergeNodeId),
      ];
      const nodeMap = new Map<string, WorkflowNode>([
        ["n1", makeNode("n1", "Node 1")],
        ["n2", makeNode("n2", "Node 2")],
        ["n3", makeNode("n3", "Node 3")],
      ]);
      const nodeOutputs = new Map<string, unknown>([
        ["n1", 1],
        ["n2", 2],
        ["n3", 3],
      ]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toEqual({ "Node 1": 1, "Node 2": 2, "Node 3": 3 });
    });

    it("uses node label as key when label is available", () => {
      const mergeNodeId = "merge-1";
      const edges = [makeEdge("src", mergeNodeId)];
      const nodeMap = new Map<string, WorkflowNode>([
        ["src", makeNode("src", "My Custom Label")],
      ]);
      const nodeOutputs = new Map<string, unknown>([["src", "value"]]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toHaveProperty("My Custom Label", "value");
    });

    it("falls back to edge.source ID when source node is not in nodeMap", () => {
      const mergeNodeId = "merge-1";
      const edges = [makeEdge("unknown-src", mergeNodeId)];
      const nodeMap = new Map<string, WorkflowNode>();
      const nodeOutputs = new Map<string, unknown>([["unknown-src", "data"]]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toHaveProperty("unknown-src", "data");
    });

    it("values can be objects", () => {
      const mergeNodeId = "merge-1";
      const edges = [makeEdge("a", mergeNodeId), makeEdge("b", mergeNodeId)];
      const nodeMap = new Map<string, WorkflowNode>([
        ["a", makeNode("a", "Search")],
        ["b", makeNode("b", "Summarize")],
      ]);
      const nodeOutputs = new Map<string, unknown>([
        ["a", { results: [1, 2, 3] }],
        ["b", { summary: "abc" }],
      ]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result["Search"]).toEqual({ results: [1, 2, 3] });
      expect(result["Summarize"]).toEqual({ summary: "abc" });
    });
  });

  // ── Edge cases ───────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns an empty object when no incoming edges exist", () => {
      const mergeNodeId = "merge-1";
      const nodeMap = new Map<string, WorkflowNode>();
      const nodeOutputs = new Map<string, unknown>();

      const result = executeMerge(mergeNodeId, [], nodeMap, nodeOutputs);

      expect(result).toEqual({});
    });

    it("skips entries where nodeOutputs has no value for the source (undefined)", () => {
      const mergeNodeId = "merge-1";
      const edges = [makeEdge("a", mergeNodeId), makeEdge("b", mergeNodeId)];
      const nodeMap = new Map<string, WorkflowNode>([
        ["a", makeNode("a", "A")],
        ["b", makeNode("b", "B")],
      ]);
      // "b" has no output stored
      const nodeOutputs = new Map<string, unknown>([["a", "value-a"]]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toHaveProperty("A", "value-a");
      expect(result).not.toHaveProperty("B");
    });

    it("includes entries with null output values", () => {
      const mergeNodeId = "merge-1";
      const edges = [makeEdge("a", mergeNodeId)];
      const nodeMap = new Map<string, WorkflowNode>([["a", makeNode("a", "Nullable")]]);
      const nodeOutputs = new Map<string, unknown>([["a", null]]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toHaveProperty("Nullable", null);
    });

    it("includes entries with empty string output values", () => {
      const mergeNodeId = "merge-1";
      const edges = [makeEdge("a", mergeNodeId)];
      const nodeMap = new Map<string, WorkflowNode>([["a", makeNode("a", "Empty")]]);
      const nodeOutputs = new Map<string, unknown>([["a", ""]]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toHaveProperty("Empty", "");
    });

    it("only processes incoming edges to the merge node (filters by target)", () => {
      const mergeNodeId = "merge-1";
      // Edge from "a" to "other-node" should not be included
      const edges = [makeEdge("a", mergeNodeId), makeEdge("a", "other-node")];
      const nodeMap = new Map<string, WorkflowNode>([["a", makeNode("a", "A")]]);
      const nodeOutputs = new Map<string, unknown>([["a", "value"]]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(Object.keys(result)).toHaveLength(1);
      expect(result["A"]).toBe("value");
    });

    it("handles a single incoming edge", () => {
      const mergeNodeId = "merge-1";
      const edges = [makeEdge("only-src", mergeNodeId)];
      const nodeMap = new Map<string, WorkflowNode>([
        ["only-src", makeNode("only-src", "Only Source")],
      ]);
      const nodeOutputs = new Map<string, unknown>([["only-src", "the output"]]);

      const result = executeMerge(mergeNodeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

      expect(result).toEqual({ "Only Source": "the output" });
    });
  });
});
