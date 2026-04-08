import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTrigger } from "../trigger";
import type { WorkflowNode, WorkflowDefinition, TriggerConfig } from "@openconclave/shared";
import type { RunEvent } from "../../types";

// ── Helpers ──────────────────────────────────────────────────

function makeTriggerNode(config: TriggerConfig, label = "Trigger"): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { label, type: "trigger", config },
  };
}

function makeWorkflow(name = "Test Workflow"): WorkflowDefinition {
  return {
    id: "wf-1",
    name,
    nodes: [],
    edges: [],
    enabled: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("executeTrigger", () => {
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emit = vi.fn();
  });

  // ── Happy path: non-chat triggers ────────────────────────────

  describe("non-chat trigger types", () => {
    it("returns triggerPayload when provided and config type is manual", () => {
      const node = makeTriggerNode({ type: "manual" });
      const workflow = makeWorkflow();
      const payload = { userId: 42 };

      const result = executeTrigger(node, undefined, payload, workflow, 1, "trigger-1", emit);

      expect(result).toEqual({ userId: 42 });
      expect(emit).not.toHaveBeenCalled();
    });

    it("returns config.prompt when no triggerPayload is provided", () => {
      const node = makeTriggerNode({ type: "manual", prompt: "Hello world" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, undefined, undefined, workflow, 1, "trigger-1", emit);

      expect(result).toBe("Hello world");
      expect(emit).not.toHaveBeenCalled();
    });

    it("returns null when no triggerPayload and no prompt", () => {
      const node = makeTriggerNode({ type: "manual" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, undefined, undefined, workflow, 1, "trigger-1", emit);

      expect(result).toBeNull();
    });

    it("triggerPayload takes precedence over config.prompt", () => {
      const node = makeTriggerNode({ type: "cron", prompt: "Default prompt" });
      const workflow = makeWorkflow();
      const payload = "custom payload";

      const result = executeTrigger(node, undefined, payload, workflow, 1, "trigger-1", emit);

      expect(result).toBe("custom payload");
    });

    it("handles webhook trigger type with payload", () => {
      const node = makeTriggerNode({ type: "webhook", webhookPath: "/my-hook" });
      const workflow = makeWorkflow();
      const payload = { event: "push", repo: "myrepo" };

      const result = executeTrigger(node, undefined, payload, workflow, 1, "trigger-1", emit);

      expect(result).toEqual({ event: "push", repo: "myrepo" });
    });

    it("handles telegram trigger type with string payload", () => {
      const node = makeTriggerNode({ type: "telegram" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, undefined, "telegram message", workflow, 1, "trigger-1", emit);

      expect(result).toBe("telegram message");
    });

    it("handles channel trigger with no payload and no prompt", () => {
      const node = makeTriggerNode({ type: "channel" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, undefined, null, workflow, 1, "trigger-1", emit);

      expect(result).toBeNull();
    });
  });

  // ── Chat trigger: input is null or undefined ─────────────────

  describe("chat trigger with no input", () => {
    it("returns triggerPayload when input is undefined", () => {
      const node = makeTriggerNode({ type: "chat" });
      const workflow = makeWorkflow();
      const payload = "start message";

      const result = executeTrigger(node, undefined, payload, workflow, 1, "trigger-1", emit);

      expect(result).toBe("start message");
      expect(emit).not.toHaveBeenCalled();
    });

    it("returns triggerPayload when input is null", () => {
      const node = makeTriggerNode({ type: "chat" });
      const workflow = makeWorkflow();
      const payload = "start message";

      const result = executeTrigger(node, null, payload, workflow, 1, "trigger-1", emit);

      expect(result).toBe("start message");
      expect(emit).not.toHaveBeenCalled();
    });

    it("returns null when chat trigger has no payload and no input", () => {
      const node = makeTriggerNode({ type: "chat" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, undefined, undefined, workflow, 1, "trigger-1", emit);

      expect(result).toBeNull();
    });
  });

  // ── Chat trigger: input is present → terminal event ──────────

  describe("chat trigger with input present", () => {
    it("emits chat:response with string input", () => {
      const node = makeTriggerNode({ type: "chat" }, "My Trigger");
      const workflow = makeWorkflow("My Workflow");

      const result = executeTrigger(node, "hello from user", undefined, workflow, 5, "trigger-1", emit);

      expect(result).toEqual({ __chatTerminal: true });
      expect(emit).toHaveBeenCalledOnce();

      const event = emit.mock.calls[0][0] as RunEvent;
      expect(event.type).toBe("chat:response");
      expect(event.runId).toBe(5);
      expect(event.nodeId).toBe("trigger-1");
      expect(event.data).toMatchObject({
        content: "hello from user",
        workflowName: "My Workflow",
        nodeLabel: "My Trigger",
      });
    });

    it("emits chat:response with object input serialized as JSON", () => {
      const node = makeTriggerNode({ type: "chat" }, "Trigger Node");
      const workflow = makeWorkflow("Workflow");

      const input = { message: "hi", turn: 2 };
      const result = executeTrigger(node, input, undefined, workflow, 10, "trigger-1", emit);

      expect(result).toEqual({ __chatTerminal: true });
      expect(emit).toHaveBeenCalledOnce();

      const event = emit.mock.calls[0][0] as RunEvent;
      expect(event.data).toMatchObject({
        content: JSON.stringify(input, null, 2),
      });
    });

    it("returns __chatTerminal: true to prevent graph propagation", () => {
      const node = makeTriggerNode({ type: "chat" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, "any input", undefined, workflow, 1, "trigger-1", emit);

      expect((result as Record<string, unknown>).__chatTerminal).toBe(true);
    });

    it("emits exactly one event even when input is a non-empty object", () => {
      const node = makeTriggerNode({ type: "chat" });
      const workflow = makeWorkflow();

      executeTrigger(node, { key: "val" }, undefined, workflow, 1, "trigger-1", emit);

      expect(emit).toHaveBeenCalledOnce();
    });

    it("captures the workflowName from the provided workflow", () => {
      const node = makeTriggerNode({ type: "chat" }, "N");
      const workflow = makeWorkflow("Special Workflow Name");

      executeTrigger(node, "input", undefined, workflow, 1, "trigger-1", emit);

      const event = emit.mock.calls[0][0] as RunEvent;
      expect((event.data as Record<string, unknown>).workflowName).toBe("Special Workflow Name");
    });

    it("captures nodeLabel from node.data.label", () => {
      const node = makeTriggerNode({ type: "chat" }, "My Chat Trigger");
      const workflow = makeWorkflow();

      executeTrigger(node, "input", undefined, workflow, 1, "trigger-1", emit);

      const event = emit.mock.calls[0][0] as RunEvent;
      expect((event.data as Record<string, unknown>).nodeLabel).toBe("My Chat Trigger");
    });
  });

  // ── Edge cases ───────────────────────────────────────────────

  describe("edge cases", () => {
    it("passes through numeric triggerPayload", () => {
      const node = makeTriggerNode({ type: "manual" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, undefined, 42, workflow, 1, "trigger-1", emit);

      expect(result).toBe(42);
    });

    it("passes through boolean triggerPayload", () => {
      const node = makeTriggerNode({ type: "manual" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, undefined, false, workflow, 1, "trigger-1", emit);

      expect(result).toBe(false);
    });

    it("passes through array triggerPayload", () => {
      const node = makeTriggerNode({ type: "manual" });
      const workflow = makeWorkflow();
      const arr = [1, 2, 3];

      const result = executeTrigger(node, undefined, arr, workflow, 1, "trigger-1", emit);

      expect(result).toEqual([1, 2, 3]);
    });

    it("string '0' in chat input (truthy) triggers chat:response", () => {
      const node = makeTriggerNode({ type: "chat" });
      const workflow = makeWorkflow();

      const result = executeTrigger(node, "0", undefined, workflow, 1, "trigger-1", emit);

      expect(result).toEqual({ __chatTerminal: true });
      expect(emit).toHaveBeenCalledOnce();
    });

    it("does not emit for manual trigger regardless of input", () => {
      const node = makeTriggerNode({ type: "manual" });
      const workflow = makeWorkflow();

      executeTrigger(node, "some input", "payload", workflow, 1, "trigger-1", emit);

      expect(emit).not.toHaveBeenCalled();
    });
  });
});
