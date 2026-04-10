/**
 * RED Tests: graph.ts Bug Report
 *
 * Bugs identified in code review:
 * 1. Dead code + missing edge validation (L9-11, L18-20)
 *    - nodeMap created but never used
 *    - Edges not validated: dangling source/target silently distort in-degrees
 *
 * 2. Error handling lacks context (L32/L38)
 *    - Generic Error instead of AppError; no cycle context
 *
 * 3. O(E) filtering on hot path (L54-60)
 *    - getIncomingEdges/getOutgoingEdges scan full array every call
 *
 * 4. Inefficient zero-degree node search (L31-35)
 *    - O(V²) worst case due to iterating inDegree map each layer
 */

import { describe, it, expect } from "vitest";
import { topologicalSort, getIncomingEdges, getOutgoingEdges } from "../graph";
import type { WorkflowNode, WorkflowEdge } from "@openconclave/shared";
import { AppError } from "@openconclave/shared";

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

describe("graph.ts - Bug: Missing Edge Validation", () => {
  it("RED: Should validate that all edge sources exist in nodes", () => {
    // Bug: Edges with non-existent source nodes are not validated
    // Currently, the function silently corrupts the in-degree calculation
    // and then throws misleading "Cycle detected" instead of validation error
    const nodes = [makeNode("a"), makeNode("b")];
    const edgesWithInvalidSource = [
      makeEdge("non_existent_node", "a"), // source doesn't exist
      makeEdge("a", "b"),
    ];

    // BUG: This throws "Cycle detected" but should throw validation error
    // The function should pre-validate edges using nodeMap
    expect(() => topologicalSort(nodes, edgesWithInvalidSource)).toThrow(
      /validation|invalid|not found/i
    );
  });

  it("RED: Should validate that all edge targets exist in nodes", () => {
    // Bug: Edges with non-existent target nodes are not validated
    const nodes = [makeNode("a"), makeNode("b")];
    const edgesWithInvalidTarget = [
      makeEdge("a", "b"),
      makeEdge("a", "non_existent_node"), // target doesn't exist
    ];

    // BUG: This should throw a validation error about missing target node
    // Currently the in-degree count gets corrupted
    expect(() => topologicalSort(nodes, edgesWithInvalidTarget)).toThrow();
  });

  it("RED: Should reject edges when both source and target don't exist", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edgesWithBothInvalid = [
      makeEdge("a", "b"),
      makeEdge("nonexistent1", "nonexistent2"),
    ];

    // BUG: Should throw validation error, not silently corrupt state
    expect(() => topologicalSort(nodes, edgesWithBothInvalid)).toThrow();
  });

  it("RED: nodeMap is unused - validation should use nodeMap to check edges", () => {
    // The nodeMap is created on line 11 but never used
    // It SHOULD be used to pre-validate all edges before processing
    const nodes = [makeNode("trigger"), makeNode("action")];
    const invalidEdges = [
      makeEdge("trigger", "action"),
      makeEdge("trigger", "missing_node"),
    ];

    // BUG: The nodeMap exists but isn't used for validation
    // This allows invalid edges to corrupt the algorithm
    expect(() => topologicalSort(nodes, invalidEdges)).toThrow();
  });
});

describe("graph.ts - Bug: Error Handling Lacks Context", () => {
  it("RED: Cycle error should include context about which nodes form the cycle", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [
      makeEdge("a", "b"),
      makeEdge("b", "c"),
      makeEdge("c", "a"), // creates cycle: a -> b -> c -> a
    ];

    let error: Error | null = null;
    try {
      topologicalSort(nodes, edges);
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();

    // BUG: Error lacks context about which nodes/edges caused the cycle
    // It should include node IDs involved in the cycle for debugging
    // Currently it just says "Cycle detected in workflow graph" with no node info
    // Should be: "Cycle detected involving nodes: a, b, c" or "Cycle: a -> b -> c -> a"
    if (error) {
      // Error message should mention specific node IDs involved in the cycle
      // At least one of 'a', 'b', or 'c' should appear in the error message
      expect(error.message).toMatch(/\ba\b|\bb\b|\bc\b/);
    }
  });

  it("RED: Cycle error should use AppError instead of plain Error", () => {
    const nodes = [makeNode("x"), makeNode("y")];
    const edges = [makeEdge("x", "y"), makeEdge("y", "x")];

    let error: unknown;
    try {
      topologicalSort(nodes, edges);
    } catch (e) {
      error = e;
    }

    // BUG: Error is currently a plain Error, not AppError
    // The code review states this is inconsistent with server's AppError pattern
    // and loses workflow-specific error codes in API responses
    expect(error).toBeInstanceOf(AppError);
  });
});

describe("graph.ts - Bug: O(E) Filtering Performance", () => {
  it("skip: getIncomingEdges and getOutgoingEdges are O(E) operations", () => {
    // BUG: These functions scan the entire edge array on every call
    // They're used in graph-walker.ts execution loop
    // For large workflows with many edges, this creates repeated O(E) cost
    //
    // SKIPPED: This is a performance bug, hard to test reliably without
    // benchmarking large graphs. The fix would be to precompute adjacency maps
    // or cache results once per topological sort run.

    const edges = Array.from({ length: 10000 }, (_, i) =>
      makeEdge(`source${i}`, `target${i}`)
    );

    const startTime = performance.now();
    for (let i = 0; i < 100; i++) {
      getIncomingEdges("target5000", edges);
    }
    const endTime = performance.now();

    // This test is O(100 * 10000) = 1M iterations
    // Performance test would need to compare against a baseline or assert < threshold
    // Since we can't reliably measure timing in test environment, we skip this
    expect(endTime - startTime).toBeGreaterThan(0); // Just verify it ran
  });
});

describe("graph.ts - Bug: O(V²) Zero-Degree Node Search", () => {
  it("skip: Inefficient zero-degree node search in topological sort", () => {
    // BUG: The algorithm iterates through the inDegree map on every layer:
    // ```
    // for (const [id, degree] of inDegree) {
    //   if (!visited.has(id) && degree === 0) {
    //     layer.push(id);
    //   }
    // }
    // ```
    // This is O(V) per layer, giving O(V²) worst case
    //
    // SKIPPED: This is a performance/algorithmic bug. The fix would be to:
    // - Initialize a queue with zero-degree nodes upfront
    // - Dequeue/process rather than iterate on each layer
    //
    // The behavior is correct (produces right output), just inefficient.
    // Performance testing would be flaky in CI environment.

    const nodes = Array.from({ length: 100 }, (_, i) => makeNode(`node${i}`));
    const edges = nodes.slice(0, -1).map((n, i) => makeEdge(n.id, nodes[i + 1].id));

    // This should work correctly, just suboptimally
    const layers = topologicalSort(nodes, edges);
    expect(layers).toHaveLength(100);
  });
});

describe("graph.ts - Bug: Unused nodeMap", () => {
  it("RED: nodeMap is created but never used for edge validation", () => {
    // BUG: Line 11 creates nodeMap but it's never referenced
    // const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    //
    // This should be used to validate edges before processing:
    // for (const edge of edges) {
    //   if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
    //     throw new ValidationError(...);
    //   }
    // }

    const nodes = [makeNode("a"), makeNode("b")];
    const edgesWithInvalidNodes = [
      makeEdge("a", "b"),
      makeEdge("a", "does_not_exist"),
    ];

    // BUG: nodeMap exists but unused, so edge validation never happens
    // This should throw a validation error, not a cycle error
    expect(() => topologicalSort(nodes, edgesWithInvalidNodes)).toThrow(
      /validation|invalid|not found|unknown/i
    );
  });
});

