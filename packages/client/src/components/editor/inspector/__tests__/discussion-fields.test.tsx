/**
 * Tests for DiscussionFields inspector component.
 *
 * Design notes:
 *  - Store state is verified directly after interactions rather than via spies,
 *    to avoid zustand spy-accumulation issues.
 *  - Controlled inputs use fireEvent.change (not userEvent.type) because the
 *    component reads from the `config` prop, not internal state.
 *
 * Covers:
 *  - Prompt textarea rendering and updates
 *  - Max rounds: valid values applied, out-of-range values rejected
 *  - Agent moderator rendering (reuses AgentFields)
 *  - Code moderator rendering (reuses CodeFields)
 *  - Config updates propagate through the nested moderator path
 *  - Remove button clears moderator
 *  - No moderator shows help text
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { DiscussionFields } from "../discussion-fields";
import type { DiscussionConfig, DiscussionModeratorConfig } from "@openconclave/shared";

// Mock api and fetch so AgentFields/CodeFields effects don't throw
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
  },
}));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

// ── Helpers ───────────────────────────────────────────────────

const NODE_ID = "disc-inspector-1";

const BASE_CONFIG: DiscussionConfig = {
  prompt: "{{transcript}}\n\nYou are {{agentName}}.",
  maxRounds: 3,
};

function seedNode(config: DiscussionConfig = BASE_CONFIG) {
  act(() => {
    useWorkflowStore.getState().addNode({
      id: NODE_ID,
      type: "discussion",
      position: { x: 0, y: 0 },
      data: { label: "Discussion", type: "discussion", config },
    } as never);
  });
}

function renderFields(config: DiscussionConfig = BASE_CONFIG) {
  render(<DiscussionFields nodeId={NODE_ID} config={config} />);
}

function getNodeConfig(): DiscussionConfig {
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === NODE_ID);
  return node!.data.config as DiscussionConfig;
}

// ── Suite ─────────────────────────────────────────────────────

describe("DiscussionFields", () => {
  beforeEach(() => {
    useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Prompt textarea ────────────────────────────────────────

  it("renders the prompt textarea with the current value", () => {
    seedNode();
    renderFields();
    const textarea = screen.getByPlaceholderText(/agentName/);
    expect(textarea).toHaveValue(BASE_CONFIG.prompt);
  });

  it("updates prompt in store when textarea changes", () => {
    seedNode();
    renderFields();

    fireEvent.change(screen.getByPlaceholderText(/agentName/), {
      target: { value: "New prompt text" },
    });

    expect(getNodeConfig().prompt).toBe("New prompt text");
  });

  it("preserves maxRounds when only prompt changes", () => {
    seedNode({ ...BASE_CONFIG, maxRounds: 8 });
    renderFields({ ...BASE_CONFIG, maxRounds: 8 });

    fireEvent.change(screen.getByPlaceholderText(/agentName/), {
      target: { value: "Updated" },
    });

    expect(getNodeConfig().maxRounds).toBe(8);
  });

  // ── Template variable hint ─────────────────────────────────

  it("renders the template variable hint", () => {
    seedNode();
    renderFields();
    expect(screen.getByText(/Variables:/)).toBeInTheDocument();
    expect(screen.getByText("{{agentName}}")).toBeInTheDocument();
    expect(screen.getByText("{{transcript}}")).toBeInTheDocument();
    expect(screen.getByText("{{round}}")).toBeInTheDocument();
  });

  // ── Max rounds ─────────────────────────────────────────────

  it("renders the max rounds input with configured value", () => {
    seedNode();
    renderFields();
    expect(screen.getByRole("spinbutton")).toHaveValue(3);
  });

  it("updates maxRounds in store for value 10", () => {
    seedNode();
    renderFields();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "10" } });
    expect(getNodeConfig().maxRounds).toBe(10);
  });

  it("updates maxRounds for boundary minimum value 1", () => {
    seedNode();
    renderFields();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
    expect(getNodeConfig().maxRounds).toBe(1);
  });

  it("updates maxRounds for boundary maximum value 100", () => {
    seedNode();
    renderFields();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "100" } });
    expect(getNodeConfig().maxRounds).toBe(100);
  });

  it("does NOT update maxRounds for value 0 (below min)", () => {
    seedNode();
    renderFields();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    expect(getNodeConfig().maxRounds).toBe(3); // unchanged
  });

  it("does NOT update maxRounds for value 101 (above max)", () => {
    seedNode();
    renderFields();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "101" } });
    expect(getNodeConfig().maxRounds).toBe(3); // unchanged
  });

  it("does NOT update maxRounds for non-numeric input", () => {
    seedNode();
    renderFields();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "abc" } });
    expect(getNodeConfig().maxRounds).toBe(3); // unchanged
  });

  it("max rounds change preserves prompt", () => {
    const config = { ...BASE_CONFIG, prompt: "Custom prompt" };
    seedNode(config);
    renderFields(config);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    expect(getNodeConfig().prompt).toBe("Custom prompt");
  });

  // ── No moderator state ─────────────────────────────────────

  it("shows 'Without a moderator' description when no moderator is set", () => {
    seedNode();
    renderFields();
    expect(screen.getByText(/without a moderator/i)).toBeInTheDocument();
  });

  it("'Without a moderator' description reflects current maxRounds", () => {
    const config = { ...BASE_CONFIG, maxRounds: 7 };
    seedNode(config);
    renderFields(config);
    const description = screen.getByText(/without a moderator/i).closest("p")!;
    expect(description.textContent).toContain("7");
  });

  it("does NOT render engine select when no moderator", () => {
    seedNode();
    renderFields();
    expect(screen.queryByDisplayValue("Claude Code")).not.toBeInTheDocument();
  });

  it("does NOT render runtime select when no moderator", () => {
    seedNode();
    renderFields();
    expect(screen.queryByDisplayValue("Python")).not.toBeInTheDocument();
  });

  it("does NOT show Remove button when no moderator", () => {
    seedNode();
    renderFields();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });

  // ── Agent moderator (reuses AgentFields) ───────────────────

  it("renders AgentFields (engine select) when moderator type is agent", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Agent Mod", type: "agent", config: { engine: "claude" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByDisplayValue("Claude Code")).toBeInTheDocument();
  });

  it("renders Model select when agent moderator engine is claude", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Agent Mod", type: "agent", config: { engine: "claude", model: "sonnet" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByDisplayValue("Sonnet")).toBeInTheDocument();
  });

  it("engine change updates engine in store, preserving systemPrompt", () => {
    const mod: DiscussionModeratorConfig = {
      type: "agent",
      node: { label: "Mod", type: "agent", config: { engine: "claude", systemPrompt: "You moderate." } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("Claude Code"), { target: { value: "ollama" } });

    const updatedCfg = getNodeConfig().moderator!.node.config as { engine: string; systemPrompt: string };
    expect(updatedCfg.engine).toBe("ollama");
    expect(updatedCfg.systemPrompt).toBe("You moderate.");
  });

  it("agent moderator change preserves outer moderator type and label", () => {
    const mod: DiscussionModeratorConfig = {
      type: "agent",
      node: { label: "My Agent", type: "agent", config: { engine: "claude", systemPrompt: "" } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("Claude Code"), { target: { value: "debug" } });

    expect(getNodeConfig().moderator!.type).toBe("agent");
    expect(getNodeConfig().moderator!.node.label).toBe("My Agent");
  });

  it("shows moderate tool help text for agent moderator", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Mod", type: "agent", config: { engine: "claude" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByText(/moderate/)).toBeInTheDocument();
    expect(screen.getByText(/"end_discussion"/)).toBeInTheDocument();
  });

  // ── Code moderator (reuses CodeFields) ─────────────────────

  it("renders CodeFields (runtime select and code textarea) when moderator type is code", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "code",
        node: { label: "Code Mod", type: "transform", config: { runtime: "python", code: "print('hi')" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByDisplayValue("Python")).toBeInTheDocument();
    expect(screen.getByDisplayValue("print('hi')")).toBeInTheDocument();
  });

  it("runtime change updates runtime in store, preserving existing code", () => {
    const mod: DiscussionModeratorConfig = {
      type: "code",
      node: { label: "Code Mod", type: "transform", config: { runtime: "python", code: "my code" } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("Python"), { target: { value: "node" } });

    const updatedCfg = getNodeConfig().moderator!.node.config as { runtime: string; code: string };
    expect(updatedCfg.runtime).toBe("node");
    expect(updatedCfg.code).toBe("my code");
  });

  it("code textarea change updates code in store, preserving runtime", () => {
    const mod: DiscussionModeratorConfig = {
      type: "code",
      node: { label: "Code Mod", type: "transform", config: { runtime: "bash", code: "echo hi" } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("echo hi"), { target: { value: "echo bye" } });

    const updatedCfg = getNodeConfig().moderator!.node.config as { runtime: string; code: string };
    expect(updatedCfg.code).toBe("echo bye");
    expect(updatedCfg.runtime).toBe("bash");
  });

  it("code moderator change preserves outer moderator fields (type, label)", () => {
    const mod: DiscussionModeratorConfig = {
      type: "code",
      node: { label: "Code Mod", type: "transform", config: { runtime: "python", code: "" } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("Python"), { target: { value: "node" } });

    expect(getNodeConfig().moderator!.type).toBe("code");
    expect(getNodeConfig().moderator!.node.label).toBe("Code Mod");
  });

  it("shows I/O format help text for code moderator", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "code",
        node: { label: "Mod", type: "transform", config: { runtime: "python", code: "" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByText(/"end_discussion"/)).toBeInTheDocument();
  });

  // ── Remove moderator ──────────────────────────────────────

  it("shows Remove button when moderator is set", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Mod", type: "agent", config: { engine: "claude" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("clicking Remove clears the moderator from the store", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Mod", type: "agent", config: { engine: "claude" } },
      },
    };
    seedNode(config);
    renderFields(config);

    fireEvent.click(screen.getByText("Remove"));

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("removing moderator preserves prompt and maxRounds", () => {
    const config: DiscussionConfig = {
      prompt: "Keep me",
      maxRounds: 9,
      moderator: {
        type: "code",
        node: { label: "Mod", type: "transform", config: { runtime: "python", code: "" } },
      },
    };
    seedNode(config);
    renderFields(config);

    fireEvent.click(screen.getByText("Remove"));

    const updated = getNodeConfig();
    expect(updated.moderator).toBeUndefined();
    expect(updated.prompt).toBe("Keep me");
    expect(updated.maxRounds).toBe(9);
  });

  // ── Section heading ────────────────────────────────────────

  it("renders the 'Moderator' section heading", () => {
    seedNode();
    renderFields();
    expect(screen.getByText("Moderator")).toBeInTheDocument();
  });
});
