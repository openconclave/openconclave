/**
 * RED tests for bugs identified in code review (2026-04-08).
 * These tests are intentionally FAILING to prove the bugs exist.
 * Do NOT fix the bugs here — fix them in workflow-store.ts.
 *
 * Bugs under test:
 *  1. debounceTimer / pendingSnapshot not cleared on reset() or loadWorkflow() — stale
 *     history is pushed after the store has been reset (race condition / memory leak).
 *  2. isChatTrigger() unsafe cast crashes when node.data.config is undefined.
 *  3. Edge bidirectional markers are NOT updated when a trigger node's config changes
 *     from {type:"chat"} to a non-chat type after the edge has already been connected.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useWorkflowStore } from "../workflow-store";

// ── Helpers ───────────────────────────────────────────────────

function makeTriggerNode(id: string, configOverride?: Record<string, unknown>) {
  return {
    id,
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      label: "Trigger",
      type: "trigger",
      config: configOverride !== undefined ? configOverride : { type: "chat" },
    },
  } as never;
}

function makeAgentNode(id: string) {
  return {
    id,
    type: "agent",
    position: { x: 100, y: 0 },
    data: {
      label: "Agent",
      type: "agent",
      config: { engine: "openai" },
    },
  } as never;
}

// ── Suite ─────────────────────────────────────────────────────

describe("workflow-store – BUG: debounceTimer not cleared on reset/loadWorkflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("BUG-1a: reset() should prevent a pending debounce snapshot from being committed to _past", () => {
    const store = useWorkflowStore.getState();

    // Add a node — this calls pushHistory(), which sets pendingSnapshot + starts debounce timer
    store.addNode(makeAgentNode("a1"));

    // Confirm the timer is armed but not yet fired
    expect(useWorkflowStore.getState()._past).toHaveLength(0);

    // Reset the store — this should cancel the pending timer/snapshot
    useWorkflowStore.getState().reset();

    // Advance time past the 50ms debounce window
    vi.advanceTimersByTime(100);

    // EXPECTED (correct behaviour): _past stays empty because we reset before the timer fired.
    // BUG: the timer still fires and pushes the stale snapshot → _past.length becomes 1.
    expect(useWorkflowStore.getState()._past).toHaveLength(0);
  });

  it("BUG-1b: loadWorkflow() should prevent a pending debounce snapshot from being committed to _past", () => {
    const store = useWorkflowStore.getState();

    // Arm the debounce timer
    store.addNode(makeAgentNode("a1"));
    expect(useWorkflowStore.getState()._past).toHaveLength(0);

    // Load a completely new workflow — should cancel the pending timer
    useWorkflowStore.getState().loadWorkflow(
      [makeAgentNode("b1")],
      [],
      "Fresh Workflow",
      ""
    );

    vi.advanceTimersByTime(100);

    // EXPECTED: _past stays empty after loadWorkflow discards the stale snapshot.
    // BUG: stale snapshot is pushed to _past after load, corrupting history.
    expect(useWorkflowStore.getState()._past).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────

describe("workflow-store – BUG: isChatTrigger() unsafe cast crashes on missing config", () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  it("BUG-2: onConnect should not throw when source trigger node has no config", () => {
    // Build a trigger node whose config is explicitly undefined —
    // a valid scenario when a node is programmatically created without defaults.
    const triggerNode = makeTriggerNode("t1", undefined as unknown as Record<string, unknown>);
    // Override data.config to be undefined to simulate the dangerous case
    (triggerNode as { data: { config: undefined } }).data.config = undefined;

    const agentNode = makeAgentNode("a1");

    useWorkflowStore.setState({
      nodes: [triggerNode, agentNode],
      edges: [],
    });

    // isChatTrigger() does: (node.data.config as TriggerConfig).type
    // When config is undefined this throws:
    //   TypeError: Cannot read properties of undefined (reading 'type')
    // EXPECTED (correct behaviour): returns false gracefully — no throw.
    // BUG: throws a TypeError at runtime.
    expect(() => {
      useWorkflowStore.getState().onConnect({
        source: "t1",
        target: "a1",
        sourceHandle: "bottom",
        targetHandle: "top",
      });
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────

describe("workflow-store – BUG: edge markers not updated when trigger config changes", () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  it("BUG-3: changing a chat trigger to a non-chat type should remove bidirectional markers from connected edges", () => {
    // Set up: a chat-trigger node already in the store
    const chatTrigger = makeTriggerNode("t1"); // config.type === "chat"
    const agentNode = makeAgentNode("a1");

    useWorkflowStore.setState({ nodes: [chatTrigger, agentNode] });

    // Connect them — onConnect reads isChatTrigger and adds markerStart for bidirectional
    useWorkflowStore.getState().onConnect({
      source: "t1",
      target: "a1",
      sourceHandle: "bottom",
      targetHandle: "top",
    });

    // Verify the edge was created with a bidirectional markerStart
    const edgeAfterConnect = useWorkflowStore.getState().edges[0];
    expect(edgeAfterConnect).toBeDefined();
    expect(edgeAfterConnect.markerStart).toBeDefined(); // bidirectional because chat trigger

    // Now change the trigger type away from "chat"
    useWorkflowStore.getState().updateNodeConfig("t1", { type: "manual" } as never);

    // EXPECTED (correct behaviour): the edge's markerStart should be removed because
    //   the source node is no longer a chat trigger.
    // BUG: updateNodeConfig only updates node data; it does NOT re-style edges,
    //   so markerStart remains on the edge even though the trigger is now "manual".
    const edgeAfterUpdate = useWorkflowStore.getState().edges[0];
    expect(edgeAfterUpdate.markerStart).toBeUndefined();
  });
});
