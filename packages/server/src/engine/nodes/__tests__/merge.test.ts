import { describe, test, expect } from "bun:test";
import type { ConclaveNode, ConclaveEdge } from "@openconclave/shared";
import { executeMerge } from "../merge";

function makeNode(id: string, label: string): ConclaveNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: { label, type: "agent", config: {} },
  };
}

function makeEdge(id: string, source: string, target: string, sourceHandle?: string): ConclaveEdge {
  return { id, source, target, sourceHandle };
}

// ── MAJOR: duplicate labels silently overwrite ────────────────────────────────

describe("executeMerge — duplicate source labels (MAJOR)", () => {
  test("two source nodes with the same label both appear in the merged result", () => {
    const mergeId = "merge-1";
    const nodeA = makeNode("agent-a", "Researcher");
    const nodeB = makeNode("agent-b", "Researcher");
    const nodeMap = new Map<string, ConclaveNode>([
      [nodeA.id, nodeA],
      [nodeB.id, nodeB],
    ]);
    const edges: ConclaveEdge[] = [
      makeEdge("e1", nodeA.id, mergeId),
      makeEdge("e2", nodeB.id, mergeId),
    ];
    const nodeOutputs = new Map<string, unknown>([
      [nodeA.id, "output-from-a"],
      [nodeB.id, "output-from-b"],
    ]);

    const result = executeMerge(mergeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

    // Both sources must be present — label-based keying collapses them into one
    expect(Object.keys(result).length).toBe(2);
    const vals = Object.values(result);
    expect(vals).toContain("output-from-a");
    expect(vals).toContain("output-from-b");
  });
});

// ── MINOR: multiple edges from same source with different handles ─────────────

describe("executeMerge — multiple handles from same source (MINOR)", () => {
  test("two edges from the same source with different handles produce two keys", () => {
    const mergeId = "merge-2";
    const src = makeNode("discussion-1", "Discussion");
    const nodeMap = new Map<string, ConclaveNode>([[src.id, src]]);
    const edges: ConclaveEdge[] = [
      makeEdge("e1", src.id, mergeId, "summary"),
      makeEdge("e2", src.id, mergeId, "last"),
    ];
    const nodeOutputs = new Map<string, unknown>([[src.id, "some-value"]]);

    const result = executeMerge(mergeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

    // Two edges → two distinct keys; label-based keying collapsed both to one
    expect(Object.keys(result).length).toBe(2);
    expect(result["discussion-1:summary"]).toBeDefined();
    expect(result["discussion-1:last"]).toBeDefined();
  });
});

// ── NIT: val !== undefined drops nodes that explicitly return undefined ────────

describe("executeMerge — undefined output is preserved as null (NIT)", () => {
  test("a node that ran and produced undefined is included in the result as null", () => {
    const mergeId = "merge-3";
    const src = makeNode("code-1", "CodeNode");
    const nodeMap = new Map<string, ConclaveNode>([[src.id, src]]);
    const edges: ConclaveEdge[] = [makeEdge("e1", src.id, mergeId)];
    // node ran (key is in map) but returned undefined
    const nodeOutputs = new Map<string, unknown>([[src.id, undefined]]);

    const result = executeMerge(mergeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

    const key = "code-1:";
    expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
    expect(result[key]).toBeNull();
  });

  test("a node that never ran is excluded from the result", () => {
    const mergeId = "merge-4";
    const src = makeNode("code-2", "CodeNode2");
    const nodeMap = new Map<string, ConclaveNode>([[src.id, src]]);
    const edges: ConclaveEdge[] = [makeEdge("e1", src.id, mergeId)];
    // node never ran — key absent from map
    const nodeOutputs = new Map<string, unknown>();

    const result = executeMerge(mergeId, edges, nodeMap, nodeOutputs) as Record<string, unknown>;

    expect(Object.keys(result).length).toBe(0);
  });
});
