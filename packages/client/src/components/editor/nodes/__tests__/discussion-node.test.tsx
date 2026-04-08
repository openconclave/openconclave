/**
 * Tests for DiscussionNode component.
 *
 * Design notes:
 *  - Store state is checked directly (not via vi.spyOn) to avoid zustand
 *    spy-accumulation issues across tests.
 *  - Controlled-input interactions use fireEvent.change, not userEvent.type.
 *  - @xyflow/react is mocked; Handle renders as a stub div.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { DiscussionNode } from "../discussion-node";
import type { DiscussionConfig } from "@openconclave/shared";

// ── Mock @xyflow/react ────────────────────────────────────────

vi.mock("@xyflow/react", () => ({
  Handle: ({ id }: { id: string }) => <div data-testid={`handle-${id}`} />,
  Position: { Top: "Top", Bottom: "Bottom", Left: "Left", Right: "Right" },
}));

// ── Helpers ───────────────────────────────────────────────────

const NODE_ID = "disc-1";

const DEFAULT_CONFIG: DiscussionConfig = {
  prompt: "{{transcript}}\n\nYou are {{agentName}}.",
  maxRounds: 3,
};

function makeProps(
  overrides: {
    id?: string;
    config?: Partial<DiscussionConfig>;
    selected?: boolean;
  } = {}
) {
  const id = overrides.id ?? NODE_ID;
  const config: DiscussionConfig = { ...DEFAULT_CONFIG, ...(overrides.config ?? {}) };
  return {
    id,
    data: { label: "Discussion", type: "discussion", config },
    selected: overrides.selected ?? false,
    dragging: false,
    zIndex: 1,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    type: "discussion",
    width: 260,
    height: 100,
  } as never;
}

function seedStore(edges: Edge[] = []) {
  act(() => {
    useWorkflowStore.getState().addNode({
      id: NODE_ID,
      type: "discussion",
      position: { x: 0, y: 0 },
      data: { label: "Discussion", type: "discussion", config: DEFAULT_CONFIG },
    } as never);
    useWorkflowStore.setState({ edges });
  });
}

function getNodeConfig(): DiscussionConfig {
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === NODE_ID);
  return node!.data.config as DiscussionConfig;
}

/** Find the outermost drag-handler div by traversing up from the empty-slot text */
function getDragRoot(): HTMLElement {
  // DOM structure (outer to inner):
  //   <div onDragOver onDragLeave onDrop>          ← 4 parents up from <p>
  //     <div class="w-[260px]...">                 ← 3 parents up
  //       ...
  //       <div class="border-t...">                ← 2 parents up
  //         <div class="rounded-lg border-2...">   ← 1 parent up (.closest div)
  //           <p>Drop an Agent or Code node here</p>
  const p = screen.getByText("Drop an Agent or Code node here");
  // p → closest div (dashed slot) → moderator wrapper → inner card → outer drag div
  return p.closest("div")!.parentElement!.parentElement!.parentElement! as HTMLElement;
}

// ── Suite ─────────────────────────────────────────────────────

describe("DiscussionNode", () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────

  it("renders the node label", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("Discussion")).toBeInTheDocument();
  });

  it("renders all five handles (top, participants, full, last, summary)", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByTestId("handle-top")).toBeInTheDocument();
    expect(screen.getByTestId("handle-participants")).toBeInTheDocument();
    expect(screen.getByTestId("handle-full")).toBeInTheDocument();
    expect(screen.getByTestId("handle-last")).toBeInTheDocument();
    expect(screen.getByTestId("handle-summary")).toBeInTheDocument();
  });

  it("renders the max-rounds badge with the configured value", () => {
    seedStore();
    render(<DiscussionNode {...makeProps({ config: { maxRounds: 7 } })} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("defaults max-rounds badge to 3 when maxRounds is omitted", () => {
    seedStore();
    render(
      <DiscussionNode
        {...makeProps({ config: { prompt: "hello" } as Partial<DiscussionConfig> as DiscussionConfig })}
      />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  // ── Participant count (BUG-1 fix) ──────────────────────────

  it("shows 'no participants' when there are no edges", () => {
    seedStore([]);
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("no participants")).toBeInTheDocument();
  });

  it("shows '1 participant' for one edge where this node is the target via targetHandle=participants", () => {
    seedStore([
      { id: "e1", source: "agent-1", sourceHandle: "bottom", target: NODE_ID, targetHandle: "participants" },
    ]);
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("1 participant")).toBeInTheDocument();
  });

  it("shows 'no participants' when discussion node is the source (outgoing edge)", () => {
    seedStore([
      { id: "e1", source: NODE_ID, sourceHandle: "participants", target: "agent-1", targetHandle: "top" },
    ]);
    render(<DiscussionNode {...makeProps()} />);
    // Only incoming edges to targetHandle="participants" are counted
    expect(screen.getByText("no participants")).toBeInTheDocument();
  });

  it("shows '2 participants' for two incoming participant edges", () => {
    seedStore([
      { id: "e1", source: "agent-1", target: NODE_ID, targetHandle: "participants" },
      { id: "e2", source: "agent-2", target: NODE_ID, targetHandle: "participants" },
    ]);
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("2 participants")).toBeInTheDocument();
  });

  it("shows '3 participants' for three incoming participant edges", () => {
    seedStore([
      { id: "e1", source: "a1", target: NODE_ID, targetHandle: "participants" },
      { id: "e2", source: "a2", target: NODE_ID, targetHandle: "participants" },
      { id: "e3", source: "a3", target: NODE_ID, targetHandle: "participants" },
    ]);
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("3 participants")).toBeInTheDocument();
  });

  it("does NOT count data edges on other handles (e.g. top input)", () => {
    seedStore([
      { id: "e1", source: "trigger-1", target: NODE_ID, targetHandle: "top" },
      { id: "e2", source: NODE_ID, sourceHandle: "bottom", target: "output-1" },
    ]);
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("no participants")).toBeInTheDocument();
  });

  it("does NOT count edges that connect two other nodes (not this node)", () => {
    seedStore([
      { id: "e1", source: "agent-X", sourceHandle: "participants", target: "agent-Y", targetHandle: "participants" },
    ]);
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("no participants")).toBeInTheDocument();
  });

  // ── Moderator slot ─────────────────────────────────────────

  it("shows empty-slot drop prompt when no moderator is configured", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    expect(screen.getByText("Drop an Agent or Code node here")).toBeInTheDocument();
  });

  it("renders a filled agent moderator with label and 'Agent' badge", () => {
    seedStore();
    render(
      <DiscussionNode
        {...makeProps({
          config: {
            ...DEFAULT_CONFIG,
            moderator: {
              type: "agent",
              node: { label: "Smart Moderator", type: "agent", config: { engine: "claude" } },
            },
          },
        })}
      />
    );
    expect(screen.getByText("Smart Moderator")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("renders a filled code moderator with 'Code' badge", () => {
    seedStore();
    render(
      <DiscussionNode
        {...makeProps({
          config: {
            ...DEFAULT_CONFIG,
            moderator: {
              type: "code",
              node: { label: "Script Bot", type: "transform", config: { runtime: "python", code: "" } },
            },
          },
        })}
      />
    );
    expect(screen.getByText("Script Bot")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
  });

  it("shows the 'Remove moderator' button when a moderator is set", () => {
    seedStore();
    render(
      <DiscussionNode
        {...makeProps({
          config: {
            ...DEFAULT_CONFIG,
            moderator: { type: "agent", node: { label: "Mod", type: "agent", config: {} } },
          },
        })}
      />
    );
    expect(screen.getByRole("button", { name: /remove moderator/i })).toBeInTheDocument();
  });

  it("clicking 'Remove moderator' clears the moderator in the store", () => {
    seedStore();
    // Set a moderator in the store
    act(() => {
      useWorkflowStore.getState().updateNodeConfig(NODE_ID, {
        moderator: { type: "agent", node: { label: "Mod", type: "agent", config: {} } },
      });
    });

    render(
      <DiscussionNode
        {...makeProps({
          config: {
            ...DEFAULT_CONFIG,
            moderator: { type: "agent", node: { label: "Mod", type: "agent", config: {} } },
          },
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /remove moderator/i }));

    // Verify store was updated
    expect(getNodeConfig().moderator).toBeUndefined();
  });

  // ── Drag-and-drop: dragOver state ──────────────────────────

  it("shows 'Drop to set moderator' while dragging a valid item over", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);

    fireEvent.dragEnter(getDragRoot(), {
      dataTransfer: { types: ["application/openconclave-node"] },
    });

    expect(screen.getByText("Drop to set moderator")).toBeInTheDocument();
  });

  it("restores 'Drop an Agent or Code node here' after dragLeave", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const root = getDragRoot();

    fireEvent.dragEnter(root, {
      dataTransfer: { types: ["application/openconclave-node"] },
    });
    fireEvent.dragLeave(root);

    expect(screen.getByText("Drop an Agent or Code node here")).toBeInTheDocument();
  });

  it("does NOT show dragOver state when dataTransfer type is not the expected MIME type", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);

    fireEvent.dragEnter(getDragRoot(), {
      dataTransfer: { types: ["text/plain"] },
    });

    // Should NOT switch to "Drop to set moderator"
    expect(screen.getByText("Drop an Agent or Code node here")).toBeInTheDocument();
  });

  // ── Drag-and-drop: drop validation (store unchanged) ──────

  it("ignores a drop with invalid JSON — store unchanged", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => "NOT_JSON", types: ["application/openconclave-node"] },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("ignores a drop with an empty payload — store unchanged", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => "", types: [] },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("ignores a drop with type='trigger' — not a valid moderator type", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const payload = JSON.stringify({ type: "trigger", label: "Start", config: { type: "manual" } });

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("ignores a drop with type='condition' — not a valid moderator type", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const payload = JSON.stringify({ type: "condition", label: "Branch", config: { expression: "" } });

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("ignores a drop where label is only whitespace", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const payload = JSON.stringify({ type: "agent", label: "   ", config: {} });

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("ignores a drop where config is null", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const payload = JSON.stringify({ type: "agent", label: "Mod", config: null });

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("ignores a drop where the payload object has no 'label' field", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const payload = JSON.stringify({ type: "agent", config: {} }); // no label

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  // ── Drag-and-drop: successful drops ───────────────────────

  it("sets an agent moderator when an agent node is dropped", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const agentConfig = { engine: "claude", systemPrompt: "You moderate." };
    const payload = JSON.stringify({ type: "agent", label: "AI Moderator", config: agentConfig });

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    const mod = getNodeConfig().moderator!;
    expect(mod.type).toBe("agent");
    expect(mod.node.label).toBe("AI Moderator");
    expect(mod.node.type).toBe("agent");
    expect(mod.node.config).toEqual(agentConfig);
  });

  it("sets a code moderator (type='code') when a transform node is dropped", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const codeConfig = { runtime: "python", code: "print('done')" };
    const payload = JSON.stringify({ type: "transform", label: "Script Mod", config: codeConfig });

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    const mod = getNodeConfig().moderator!;
    expect(mod.type).toBe("code");
    expect(mod.node.label).toBe("Script Mod");
    expect(mod.node.type).toBe("transform");
    expect(mod.node.config).toEqual(codeConfig);
  });

  it("a successful drop preserves existing prompt and maxRounds", () => {
    seedStore();
    act(() => {
      useWorkflowStore.getState().updateNodeConfig(NODE_ID, { prompt: "Custom prompt", maxRounds: 10 });
    });

    render(<DiscussionNode {...makeProps({ config: { prompt: "Custom prompt", maxRounds: 10 } })} />);
    const payload = JSON.stringify({ type: "agent", label: "Mod", config: {} });

    fireEvent.drop(getDragRoot(), {
      dataTransfer: { getData: () => payload, types: ["application/openconclave-node"] },
    });

    // Shallow merge preserves other fields
    const config = getNodeConfig();
    expect(config.prompt).toBe("Custom prompt");
    expect(config.maxRounds).toBe(10);
    expect(config.moderator).toBeDefined();
  });

  // ── Selection / active state ───────────────────────────────

  it("applies ring styles when selected=true", () => {
    seedStore();
    render(<DiscussionNode {...makeProps({ selected: true })} />);
    const card = screen.getByText("Discussion").closest(".rounded-xl")!;
    expect(card.className).toContain("ring-1");
  });

  it("does NOT apply ring when selected=false", () => {
    seedStore();
    render(<DiscussionNode {...makeProps({ selected: false })} />);
    const card = screen.getByText("Discussion").closest(".rounded-xl")!;
    expect(card.className).not.toContain("ring-1");
  });

  it("applies node-running animation class when node is active", () => {
    seedStore();
    act(() => {
      useWorkflowStore.setState({ activeNodeIds: new Set([NODE_ID]) });
    });

    render(<DiscussionNode {...makeProps()} />);
    const card = screen.getByText("Discussion").closest(".rounded-xl")!;
    expect(card.className).toContain("node-running");
  });

  it("does NOT apply node-running when node is not active", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const card = screen.getByText("Discussion").closest(".rounded-xl")!;
    expect(card.className).not.toContain("node-running");
  });

  // ── Click to select ────────────────────────────────────────

  it("clicking the card sets this node as selected in the store", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);

    fireEvent.click(screen.getByText("Discussion").closest(".rounded-xl")!);

    expect(useWorkflowStore.getState().selectedNodeId).toBe(NODE_ID);
  });

  // ── drag counter prevents flicker ──────────────────────────

  it("stays in dragOver state when dragEnter fires on a child (counter-based)", () => {
    seedStore();
    render(<DiscussionNode {...makeProps()} />);
    const root = getDragRoot();
    const dt = { types: ["application/openconclave-node"] };

    // Two nested dragEnter events (parent + child)
    fireEvent.dragEnter(root, { dataTransfer: dt });
    fireEvent.dragEnter(root, { dataTransfer: dt });
    // One dragLeave (child → parent) — counter decrements but doesn't reach 0
    fireEvent.dragLeave(root);

    expect(screen.getByText("Drop to set moderator")).toBeInTheDocument();
  });
});
