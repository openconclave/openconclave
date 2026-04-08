import { describe, it, expect, vi } from "vitest";
import { executeCondition } from "../condition";
import type { WorkflowNode, ConditionConfig } from "@openconclave/shared";

vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────

function makeConditionNode(expression: string, label = "Condition"): WorkflowNode {
  const config: ConditionConfig = { expression };
  return {
    id: "cond-1",
    type: "condition",
    position: { x: 0, y: 0 },
    data: { label, type: "condition", config },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("executeCondition", () => {
  // ── Return shape ─────────────────────────────────────────────

  describe("return shape", () => {
    it("always returns an object with __conditionResult and __passthrough", () => {
      const node = makeConditionNode("input === 'yes'");

      const result = executeCondition(node, "yes");

      expect(result).toHaveProperty("__conditionResult");
      expect(result).toHaveProperty("__passthrough");
    });

    it("__passthrough equals the input unchanged", () => {
      const node = makeConditionNode("input > 5");
      const input = { message: "hello", count: 10 };

      const result = executeCondition(node, input) as Record<string, unknown>;

      expect(result.__passthrough).toBe(input);
    });

    it("__passthrough is exactly the same reference as input", () => {
      const node = makeConditionNode("true");
      const input = [1, 2, 3];

      const result = executeCondition(node, input) as Record<string, unknown>;

      expect(result.__passthrough).toBe(input);
    });
  });

  // ── True conditions ──────────────────────────────────────────

  describe("conditions evaluating to true", () => {
    it("returns __conditionResult true for matching string comparison", () => {
      const node = makeConditionNode("input === 'done'");

      const result = executeCondition(node, "done") as Record<string, unknown>;

      expect(result.__conditionResult).toBe(true);
    });

    it("returns true for numeric greater-than", () => {
      const node = makeConditionNode("input > 5");

      const result = executeCondition(node, 10) as Record<string, unknown>;

      expect(result.__conditionResult).toBe(true);
    });

    it("returns true for object property comparison", () => {
      const node = makeConditionNode("input.status === 'ok'");

      const result = executeCondition(node, { status: "ok" }) as Record<string, unknown>;

      expect(result.__conditionResult).toBe(true);
    });

    it("returns true for explicit boolean literal", () => {
      const node = makeConditionNode("true");

      const result = executeCondition(node, null) as Record<string, unknown>;

      expect(result.__conditionResult).toBe(true);
    });

    it("returns true for logical AND both sides true", () => {
      const node = makeConditionNode("input.a === 1 && input.b === 2");

      const result = executeCondition(node, { a: 1, b: 2 }) as Record<string, unknown>;

      expect(result.__conditionResult).toBe(true);
    });
  });

  // ── False conditions ─────────────────────────────────────────

  describe("conditions evaluating to false", () => {
    it("returns __conditionResult false for non-matching string", () => {
      const node = makeConditionNode("input === 'done'");

      const result = executeCondition(node, "continue") as Record<string, unknown>;

      expect(result.__conditionResult).toBe(false);
    });

    it("returns false for numeric less-than", () => {
      const node = makeConditionNode("input > 5");

      const result = executeCondition(node, 3) as Record<string, unknown>;

      expect(result.__conditionResult).toBe(false);
    });

    it("returns false for explicit false literal", () => {
      const node = makeConditionNode("false");

      const result = executeCondition(node, "anything") as Record<string, unknown>;

      expect(result.__conditionResult).toBe(false);
    });

    it("returns false for null input on truthy check", () => {
      const node = makeConditionNode("input");

      const result = executeCondition(node, null) as Record<string, unknown>;

      expect(result.__conditionResult).toBe(false);
    });

    it("returns false for empty string input on truthy check", () => {
      const node = makeConditionNode("input");

      const result = executeCondition(node, "") as Record<string, unknown>;

      expect(result.__conditionResult).toBe(false);
    });

    it("returns false for logical AND with one false side", () => {
      const node = makeConditionNode("input.a === 1 && input.b === 2");

      const result = executeCondition(node, { a: 1, b: 99 }) as Record<string, unknown>;

      expect(result.__conditionResult).toBe(false);
    });
  });

  // ── Passthrough preservation ──────────────────────────────────

  describe("passthrough preservation for different input types", () => {
    it("passes through string input", () => {
      const node = makeConditionNode("true");

      const result = executeCondition(node, "hello") as Record<string, unknown>;

      expect(result.__passthrough).toBe("hello");
    });

    it("passes through number input", () => {
      const node = makeConditionNode("input > 0");

      const result = executeCondition(node, 42) as Record<string, unknown>;

      expect(result.__passthrough).toBe(42);
    });

    it("passes through null input", () => {
      const node = makeConditionNode("false");

      const result = executeCondition(node, null) as Record<string, unknown>;

      expect(result.__passthrough).toBeNull();
    });

    it("passes through undefined input", () => {
      const node = makeConditionNode("false");

      const result = executeCondition(node, undefined) as Record<string, unknown>;

      expect(result.__passthrough).toBeUndefined();
    });

    it("passes through object input without mutation", () => {
      const node = makeConditionNode("input.status === 'ok'");
      const input = { status: "ok", extra: [1, 2, 3] };

      const result = executeCondition(node, input) as Record<string, unknown>;

      expect(result.__passthrough).toEqual({ status: "ok", extra: [1, 2, 3] });
      expect(result.__passthrough).toBe(input);
    });
  });

  // ── Expression security (delegated to evaluateExpression) ────

  describe("invalid / blocked expressions", () => {
    it("throws for blocked keyword 'eval'", () => {
      const node = makeConditionNode('eval("1+1")');

      expect(() => executeCondition(node, "")).toThrow();
    });

    it("throws for blocked keyword 'import'", () => {
      const node = makeConditionNode('import("fs")');

      expect(() => executeCondition(node, "")).toThrow();
    });

    it("throws for blocked keyword 'process'", () => {
      const node = makeConditionNode("process.exit()");

      expect(() => executeCondition(node, "")).toThrow();
    });
  });
});
