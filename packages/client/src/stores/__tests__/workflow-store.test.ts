/**
 * Tests for workflow-store.ts — focusing on the logic relevant to the
 * discussion node feature:
 *  - updateNodeConfig shallow merge (preserves all non-patched fields)
 *  - removeNode clears edges and deselects the node
 *  - edge handling relevant to participant count (store state integrity)
 *  - edgeStyle helper
 *  - loadWorkflow resets isDirty and applies edge styles
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore, edgeStyle } from "../workflow-store";
import type { DiscussionConfig } from "@openconclave/shared";
import { MarkerType } from "@xyflow/react";

// ── Helpers ───────────────────────────────────────────────────

const DISC_CONFIG: DiscussionConfig = {
  prompt: "{{transcript}}",
  maxRounds: 3,
};

function makeDiscussionNode(id: string, config: Partial<DiscussionConfig> = {}) {
  return {
    id,
    type: "discussion",
    position: { x: 0, y: 0 },
    data: {
      label: "Discussion",
      type: "discussion",
      config: { ...DISC_CONFIG, ...config },
    },
  } as never;
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string
) {
  return { id, source, target, sourceHandle, targetHandle };
}

// ── Suite ─────────────────────────────────────────────────────

describe("workflow-store", () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  // ── addNode / basic state ──────────────────────────────────

  it("addNode appends a node and marks isDirty", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });

  // ── updateNodeConfig shallow merge ─────────────────────────

  it("updateNodeConfig merges patch fields without removing unpatched fields", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1", { maxRounds: 5 }));

    useWorkflowStore.getState().updateNodeConfig("d1", { prompt: "new prompt" });

    const updated = useWorkflowStore.getState().nodes.find((n) => n.id === "d1")!;
    const config = updated.data.config as DiscussionConfig;
    // prompt updated
    expect(config.prompt).toBe("new prompt");
    // maxRounds preserved by shallow merge
    expect(config.maxRounds).toBe(5);
  });

  it("updateNodeConfig can set moderator to undefined without losing maxRounds", () => {
    const withMod: Partial<DiscussionConfig> = {
      maxRounds: 7,
      moderator: {
        type: "agent",
        node: { label: "Mod", type: "agent", config: {} },
      },
    };
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1", withMod));

    useWorkflowStore.getState().updateNodeConfig("d1", { moderator: undefined });

    const updated = useWorkflowStore.getState().nodes.find((n) => n.id === "d1")!;
    const config = updated.data.config as DiscussionConfig;
    expect(config.moderator).toBeUndefined();
    expect(config.maxRounds).toBe(7);
    expect(config.prompt).toBe(DISC_CONFIG.prompt);
  });

  it("updateNodeConfig on unknown node id is a no-op", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));
    useWorkflowStore.getState().updateNodeConfig("UNKNOWN", { maxRounds: 99 });
    // d1 unchanged
    const d1 = useWorkflowStore.getState().nodes.find((n) => n.id === "d1")!;
    expect((d1.data.config as DiscussionConfig).maxRounds).toBe(3);
  });

  // ── removeNode ─────────────────────────────────────────────

  it("removeNode removes the node and all its edges", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));
    store.addNode(makeDiscussionNode("agent1"));
    useWorkflowStore.setState({
      edges: [
        makeEdge("e1", "agent1", "d1", "bottom", "participants"),
        makeEdge("e2", "d1", "agent2", "participants", "top"),
        makeEdge("e3", "trigger1", "agent1", "bottom", "top"),
      ],
    });

    useWorkflowStore.getState().removeNode("d1");

    const state = useWorkflowStore.getState();
    expect(state.nodes.find((n) => n.id === "d1")).toBeUndefined();
    // edges to/from d1 removed
    expect(state.edges.find((e) => e.id === "e1")).toBeUndefined();
    expect(state.edges.find((e) => e.id === "e2")).toBeUndefined();
    // unrelated edge preserved
    expect(state.edges.find((e) => e.id === "e3")).toBeDefined();
  });

  it("removeNode deselects the node if it was selected", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));
    useWorkflowStore.setState({ selectedNodeId: "d1" });

    useWorkflowStore.getState().removeNode("d1");

    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });

  it("removeNode does NOT deselect a different selected node", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));
    store.addNode(makeDiscussionNode("d2"));
    useWorkflowStore.setState({ selectedNodeId: "d2" });

    useWorkflowStore.getState().removeNode("d1");

    expect(useWorkflowStore.getState().selectedNodeId).toBe("d2");
  });

  // ── Edge state integrity for participant count ─────────────

  it("edges set directly have correct source/target for participant count logic", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));

    useWorkflowStore.setState({
      edges: [
        makeEdge("e1", "agent-A", "d1", "bottom", "participants"),
        makeEdge("e2", "d1", "agent-B", "participants", "top"),
        makeEdge("e3", "d1", "output-1", "bottom", "top"), // data edge, not participants
      ],
    });

    const { edges } = useWorkflowStore.getState();

    // Simulate the exact BUG-1 fix filter used in discussion-node.tsx
    const participantCount = edges.filter(
      (e) =>
        (e.source === "d1" && e.sourceHandle === "participants") ||
        (e.target === "d1" && e.targetHandle === "participants")
    ).length;

    expect(participantCount).toBe(2);
  });

  it("data edges (non-participants handle) are not counted as participants", () => {
    useWorkflowStore.setState({
      edges: [
        makeEdge("e1", "trigger-1", "d1", "bottom", "top"),
        makeEdge("e2", "d1", "output-1", "bottom", "top"),
      ],
    });

    const { edges } = useWorkflowStore.getState();
    const participantCount = edges.filter(
      (e) =>
        (e.source === "d1" && e.sourceHandle === "participants") ||
        (e.target === "d1" && e.targetHandle === "participants")
    ).length;

    expect(participantCount).toBe(0);
  });

  // ── setSelectedNode ────────────────────────────────────────

  it("setSelectedNode updates selectedNodeId", () => {
    useWorkflowStore.getState().setSelectedNode("d1");
    expect(useWorkflowStore.getState().selectedNodeId).toBe("d1");
  });

  it("setSelectedNode accepts null (deselect)", () => {
    useWorkflowStore.setState({ selectedNodeId: "d1" });
    useWorkflowStore.getState().setSelectedNode(null);
    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });

  // ── setActiveNodes ─────────────────────────────────────────

  it("setActiveNodes updates the activeNodeIds Set", () => {
    useWorkflowStore.getState().setActiveNodes(new Set(["d1", "d2"]));
    const { activeNodeIds } = useWorkflowStore.getState();
    expect(activeNodeIds.has("d1")).toBe(true);
    expect(activeNodeIds.has("d2")).toBe(true);
  });

  // ── reset ─────────────────────────────────────────────────

  it("reset clears nodes, edges, isDirty, selectedNodeId and activeNodeIds", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));
    useWorkflowStore.setState({ selectedNodeId: "d1", activeNodeIds: new Set(["d1"]) });

    useWorkflowStore.getState().reset();

    const state = useWorkflowStore.getState();
    expect(state.nodes).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
    expect(state.isDirty).toBe(false);
    expect(state.selectedNodeId).toBeNull();
    expect(state.activeNodeIds.size).toBe(0);
  });

  // ── updateNodeData ─────────────────────────────────────────

  it("updateNodeData merges top-level data fields (e.g. label)", () => {
    const store = useWorkflowStore.getState();
    store.addNode(makeDiscussionNode("d1"));

    useWorkflowStore.getState().updateNodeData("d1", { label: "Round Table" });

    const updated = useWorkflowStore.getState().nodes.find((n) => n.id === "d1")!;
    expect(updated.data.label).toBe("Round Table");
    // config still intact
    expect((updated.data.config as DiscussionConfig).maxRounds).toBe(3);
  });

  // ── loadWorkflow ───────────────────────────────────────────

  it("loadWorkflow resets isDirty and clears selection", () => {
    useWorkflowStore.setState({ isDirty: true, selectedNodeId: "d1" });

    useWorkflowStore.getState().loadWorkflow(
      [makeDiscussionNode("d1")],
      [],
      "Test Workflow",
      "desc"
    );

    const state = useWorkflowStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.selectedNodeId).toBeNull();
    expect(state.workflowName).toBe("Test Workflow");
  });

  // ── edgeStyle helper ──────────────────────────────────────

  it("edgeStyle returns cyan color for 'bottom' handle", () => {
    const { style } = edgeStyle("bottom");
    expect(style.stroke).toBe("oklch(0.65 0.18 200)");
  });

  it("edgeStyle returns blue color for 'left' handle", () => {
    const { style } = edgeStyle("left");
    expect(style.stroke).toBe("oklch(0.65 0.18 260)");
  });

  it("edgeStyle returns cyan (default) for unknown handle id", () => {
    const { style } = edgeStyle("participants");
    // "participants" not in HANDLE_STROKE map → falls through to DEFAULT_STROKE (cyan)
    expect(style.stroke).toBe("oklch(0.65 0.18 200)");
  });

  it("edgeStyle returns arrowClosed markerEnd", () => {
    const { markerEnd } = edgeStyle("bottom");
    expect((markerEnd as { type: string }).type).toBe(MarkerType.ArrowClosed);
  });

  it("edgeStyle adds markerStart for bidirectional=true", () => {
    const result = edgeStyle("bottom", true);
    expect(result.markerStart).toBeDefined();
    expect((result.markerStart as { type: string }).type).toBe(MarkerType.ArrowClosed);
  });

  it("edgeStyle does NOT add markerStart for bidirectional=false", () => {
    const result = edgeStyle("bottom", false);
    expect(result.markerStart).toBeUndefined();
  });
});
