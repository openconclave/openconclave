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
 *  - Moderator type selector (none / code / agent)
 *  - Code moderator inline editor
 *  - Agent moderator inline editor (engine sub-fields)
 *  - Default configs applied when switching moderator type
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { DiscussionFields } from "./discussion-fields";
import type { DiscussionConfig, DiscussionModeratorConfig } from "@openconclave/shared";

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

  // ── Moderator type selector ────────────────────────────────

  it("renders the moderator type select defaulting to 'none'", () => {
    seedNode();
    renderFields();
    expect(screen.getByDisplayValue("None (sequential, all participants)")).toBeInTheDocument();
  });

  it("shows 'Without a moderator' description when type is none", () => {
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

  it("selecting 'code' creates a code moderator in the store", () => {
    seedNode();
    renderFields();

    fireEvent.change(screen.getByDisplayValue("None (sequential, all participants)"), {
      target: { value: "code" },
    });

    const mod = getNodeConfig().moderator!;
    expect(mod.type).toBe("code");
    expect(mod.node.type).toBe("transform");
    expect(mod.node.label).toBe("Code Moderator");
  });

  it("selecting 'agent' creates an agent moderator in the store", () => {
    seedNode();
    renderFields();

    fireEvent.change(screen.getByDisplayValue("None (sequential, all participants)"), {
      target: { value: "agent" },
    });

    const mod = getNodeConfig().moderator!;
    expect(mod.type).toBe("agent");
    expect(mod.node.type).toBe("agent");
    expect(mod.node.label).toBe("Agent Moderator");
  });

  it("selecting 'none' clears an existing moderator in the store", () => {
    const configWithMod: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: { type: "agent", node: { label: "Mod", type: "agent", config: {} } },
    };
    seedNode(configWithMod);
    renderFields(configWithMod);

    fireEvent.change(screen.getByDisplayValue("Agent (LLM-driven)"), {
      target: { value: "none" },
    });

    expect(getNodeConfig().moderator).toBeUndefined();
  });

  it("switching moderator type preserves prompt and maxRounds (shallow merge)", () => {
    const config = { ...BASE_CONFIG, prompt: "Keep me", maxRounds: 9 };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("None (sequential, all participants)"), {
      target: { value: "code" },
    });

    const updatedConfig = getNodeConfig();
    expect(updatedConfig.prompt).toBe("Keep me");
    expect(updatedConfig.maxRounds).toBe(9);
  });

  // ── Default configs ────────────────────────────────────────

  it("default code config includes 'end_discussion' in code template", () => {
    seedNode();
    renderFields();

    fireEvent.change(screen.getByDisplayValue("None (sequential, all participants)"), {
      target: { value: "code" },
    });

    const code = (getNodeConfig().moderator!.node.config as { code: string }).code;
    expect(code).toContain("end_discussion");
  });

  it("default code config uses python runtime", () => {
    seedNode();
    renderFields();

    fireEvent.change(screen.getByDisplayValue("None (sequential, all participants)"), {
      target: { value: "code" },
    });

    const cfg = getNodeConfig().moderator!.node.config as { runtime: string };
    expect(cfg.runtime).toBe("python");
  });

  it("default agent config system prompt mentions 'moderate'", () => {
    seedNode();
    renderFields();

    fireEvent.change(screen.getByDisplayValue("None (sequential, all participants)"), {
      target: { value: "agent" },
    });

    const cfg = getNodeConfig().moderator!.node.config as { systemPrompt: string };
    expect(cfg.systemPrompt).toContain("moderate");
  });

  it("default agent config uses claude engine", () => {
    seedNode();
    renderFields();

    fireEvent.change(screen.getByDisplayValue("None (sequential, all participants)"), {
      target: { value: "agent" },
    });

    const cfg = getNodeConfig().moderator!.node.config as { engine: string };
    expect(cfg.engine).toBe("claude");
  });

  // ── Code moderator inline editor ───────────────────────────

  it("renders runtime select and code textarea when moderator type is code", () => {
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
    expect(updatedCfg.code).toBe("my code"); // preserved
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
    expect(updatedCfg.runtime).toBe("bash"); // preserved
  });

  it("code moderator change preserves outer moderator fields (e.g. type)", () => {
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

  // ── Agent moderator inline editor ─────────────────────────

  it("renders engine select when moderator type is agent", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Agent Mod", type: "agent", config: { engine: "claude" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByDisplayValue("Claude")).toBeInTheDocument();
  });

  it("renders Model select when engine is claude", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Agent Mod", type: "agent", config: { engine: "claude", model: "sonnet" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByDisplayValue("claude-sonnet (latest)")).toBeInTheDocument();
  });

  it("renders Ollama Model text input when engine is ollama", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Agent Mod", type: "agent", config: { engine: "ollama", ollamaModel: "llama3" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.getByDisplayValue("llama3")).toBeInTheDocument();
  });

  it("does NOT show the claude Model select when engine is ollama", () => {
    const config: DiscussionConfig = {
      ...BASE_CONFIG,
      moderator: {
        type: "agent",
        node: { label: "Agent Mod", type: "agent", config: { engine: "ollama" } },
      },
    };
    seedNode(config);
    renderFields(config);

    expect(screen.queryByText("claude-sonnet (latest)")).not.toBeInTheDocument();
    expect(screen.queryByText("claude-haiku (fast)")).not.toBeInTheDocument();
  });

  it("engine change updates engine in store, preserving systemPrompt", () => {
    const mod: DiscussionModeratorConfig = {
      type: "agent",
      node: { label: "Mod", type: "agent", config: { engine: "claude", systemPrompt: "You moderate." } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("Claude"), { target: { value: "ollama" } });

    const updatedCfg = getNodeConfig().moderator!.node.config as { engine: string; systemPrompt: string };
    expect(updatedCfg.engine).toBe("ollama");
    expect(updatedCfg.systemPrompt).toBe("You moderate."); // preserved
  });

  it("system prompt change updates systemPrompt in store", () => {
    const mod: DiscussionModeratorConfig = {
      type: "agent",
      node: { label: "Mod", type: "agent", config: { engine: "claude", systemPrompt: "Old prompt." } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("Old prompt."), {
      target: { value: "New system prompt." },
    });

    const updatedCfg = getNodeConfig().moderator!.node.config as { systemPrompt: string };
    expect(updatedCfg.systemPrompt).toBe("New system prompt.");
  });

  it("agent moderator change preserves outer moderator type and label", () => {
    const mod: DiscussionModeratorConfig = {
      type: "agent",
      node: { label: "My Agent", type: "agent", config: { engine: "claude", systemPrompt: "" } },
    };
    const config: DiscussionConfig = { ...BASE_CONFIG, moderator: mod };
    seedNode(config);
    renderFields(config);

    fireEvent.change(screen.getByDisplayValue("Claude"), { target: { value: "debug" } });

    expect(getNodeConfig().moderator!.type).toBe("agent");
    expect(getNodeConfig().moderator!.node.label).toBe("My Agent");
  });

  // ── No code/agent editor when type is none ─────────────────

  it("does NOT render runtime select when no moderator", () => {
    seedNode();
    renderFields();
    expect(screen.queryByDisplayValue("Python")).not.toBeInTheDocument();
    expect(screen.queryByText("Moderator Code")).not.toBeInTheDocument();
  });

  it("does NOT render engine select when no moderator", () => {
    seedNode();
    renderFields();
    expect(screen.queryByDisplayValue("Claude")).not.toBeInTheDocument();
    expect(screen.queryByText("Engine")).not.toBeInTheDocument();
  });

  // ── Node label field (shown in NodeInspector) ─────────────

  it("renders the 'Moderator' section heading", () => {
    seedNode();
    renderFields();
    // There's a "Moderator" heading in the form
    expect(screen.getByText("Moderator")).toBeInTheDocument();
  });
});
