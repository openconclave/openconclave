import { describe, it, expect } from "vitest";
import { topologicalSort, getIncomingEdges, getOutgoingEdges } from "./graph";
import type { WorkflowNode, WorkflowEdge } from "@openconclave/shared";

const makeNode = (id: string, type = "agent"): WorkflowNode => ({
  id,
  type: type as WorkflowNode["type"],
  position: { x: 0, y: 0 },
  data: { label: id, type: type as WorkflowNode["type"], config: { prompt: "test" } },
});

const makeEdge = (source: string, target: string): WorkflowEdge => ({
  id: `${source}-${target}`,
  source,
  target,
});

describe("topologicalSort", () => {
  it("sorts a linear chain", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const layers = topologicalSort(nodes, edges);

    expect(layers).toHaveLength(3);
    expect(layers[0].nodeIds).toEqual(["a"]);
    expect(layers[1].nodeIds).toEqual(["b"]);
    expect(layers[2].nodeIds).toEqual(["c"]);
  });

  it("identifies parallel nodes", () => {
    const nodes = [makeNode("trigger"), makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [
      makeEdge("trigger", "a"),
      makeEdge("trigger", "b"),
      makeEdge("a", "c"),
      makeEdge("b", "c"),
    ];
    const layers = topologicalSort(nodes, edges);

    expect(layers).toHaveLength(3);
    expect(layers[0].nodeIds).toEqual(["trigger"]);
    expect(layers[1].nodeIds).toContain("a");
    expect(layers[1].nodeIds).toContain("b");
    expect(layers[2].nodeIds).toEqual(["c"]);
  });

  it("throws on cycle", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("a", "b"), makeEdge("b", "a")];

    expect(() => topologicalSort(nodes, edges)).toThrow("Cycle detected");
  });

  it("handles single node", () => {
    const nodes = [makeNode("a")];
    const layers = topologicalSort(nodes, []);

    expect(layers).toHaveLength(1);
    expect(layers[0].nodeIds).toEqual(["a"]);
  });
});

describe("getIncomingEdges", () => {
  it("returns edges targeting the node", () => {
    const edges = [makeEdge("a", "b"), makeEdge("c", "b"), makeEdge("a", "c")];
    const incoming = getIncomingEdges("b", edges);

    expect(incoming).toHaveLength(2);
    expect(incoming.map((e) => e.source)).toContain("a");
    expect(incoming.map((e) => e.source)).toContain("c");
  });

  it("returns empty for entry nodes", () => {
    const edges = [makeEdge("a", "b")];
    expect(getIncomingEdges("a", edges)).toHaveLength(0);
  });
});

describe("getOutgoingEdges", () => {
  it("returns edges from the node", () => {
    const edges = [makeEdge("a", "b"), makeEdge("a", "c"), makeEdge("b", "c")];
    const outgoing = getOutgoingEdges("a", edges);

    expect(outgoing).toHaveLength(2);
    expect(outgoing.map((e) => e.target)).toContain("b");
    expect(outgoing.map((e) => e.target)).toContain("c");
  });
});
