import { describe, it, expect } from "vitest";
import { renderTemplate } from "../template";

// ── Tests ─────────────────────────────────────────────────────

describe("renderTemplate", () => {
  // ── Basic substitution ───────────────────────────────────────

  describe("basic substitution", () => {
    it("replaces a single top-level variable", () => {
      const result = renderTemplate("Hello, {{agentName}}!", { agentName: "Alice" });
      expect(result).toBe("Hello, Alice!");
    });

    it("replaces multiple variables in a single template", () => {
      const result = renderTemplate("Round {{round}}: {{agentName}} speaks", {
        agentName: "Bob",
        round: 3,
      });
      expect(result).toBe("Round 3: Bob speaks");
    });

    it("replaces the same variable appearing multiple times", () => {
      const result = renderTemplate("{{agentName}} and {{agentName}}", { agentName: "Carol" });
      expect(result).toBe("Carol and Carol");
    });

    it("leaves text without braces unchanged", () => {
      const result = renderTemplate("No placeholders here.", {});
      expect(result).toBe("No placeholders here.");
    });

    it("returns empty string for an empty template", () => {
      const result = renderTemplate("", { agentName: "Dave" });
      expect(result).toBe("");
    });

    it("handles context with a number value", () => {
      const result = renderTemplate("Round {{round}}", { round: 1 });
      expect(result).toBe("Round 1");
    });

    it("handles context with a boolean value", () => {
      const result = renderTemplate("Active: {{active}}", { active: true });
      expect(result).toBe("Active: true");
    });
  });

  // ── Dot notation ─────────────────────────────────────────────

  describe("dot notation", () => {
    it("resolves a single-level nested property", () => {
      const result = renderTemplate("Topic: {{input.topic}}", { input: { topic: "AI safety" } });
      expect(result).toBe("Topic: AI safety");
    });

    it("resolves a deeply nested property", () => {
      const result = renderTemplate("Value: {{a.b.c}}", { a: { b: { c: "deep" } } });
      expect(result).toBe("Value: deep");
    });

    it("returns empty string when nested path does not exist", () => {
      const result = renderTemplate("{{input.missing}}", { input: {} });
      expect(result).toBe("");
    });

    it("returns empty string when intermediate path segment is not an object", () => {
      const result = renderTemplate("{{input.a.b}}", { input: { a: "string" } });
      expect(result).toBe("");
    });

    it("returns empty string when the root key is absent from context", () => {
      const result = renderTemplate("{{missing}}", {});
      expect(result).toBe("");
    });

    it("returns empty string for path with non-object intermediate (number)", () => {
      const result = renderTemplate("{{a.b}}", { a: 42 });
      expect(result).toBe("");
    });
  });

  // ── Object serialisation ──────────────────────────────────────

  describe("object and array values", () => {
    it("JSON.stringify objects when substituted", () => {
      const result = renderTemplate("Data: {{input}}", { input: { key: "value" } });
      expect(result).toBe('Data: {"key":"value"}');
    });

    it("JSON.stringify arrays when substituted", () => {
      const result = renderTemplate("Items: {{items}}", { items: [1, 2, 3] });
      expect(result).toBe("Items: [1,2,3]");
    });

    it("JSON.stringify a nested object reached via dot path", () => {
      const result = renderTemplate("{{input.nested}}", { input: { nested: { x: 1 } } });
      expect(result).toBe('{"x":1}');
    });
  });

  // ── Null / undefined values ──────────────────────────────────

  describe("null and undefined values", () => {
    it("renders empty string for a null top-level value (null ?? '' = '')", () => {
      // Implementation: String(value ?? "") — null coalesces to "", not "null"
      const result = renderTemplate("{{v}}", { v: null });
      expect(result).toBe("");
    });

    it("renders empty string for undefined top-level value", () => {
      const result = renderTemplate("{{v}}", { v: undefined });
      expect(result).toBe("");
    });
  });

  // ── Security: unsafe key blocking ────────────────────────────

  describe("unsafe key blocking", () => {
    it("blocks __proto__ traversal and returns empty string", () => {
      const result = renderTemplate("{{__proto__}}", {});
      expect(result).toBe("");
    });

    it("blocks constructor traversal", () => {
      const result = renderTemplate("{{constructor}}", {});
      expect(result).toBe("");
    });

    it("blocks prototype traversal", () => {
      const result = renderTemplate("{{prototype}}", {});
      expect(result).toBe("");
    });

    it("blocks __proto__ anywhere in a dot path", () => {
      const result = renderTemplate("{{input.__proto__.polluted}}", {
        input: { safe: "value" },
      });
      expect(result).toBe("");
    });

    it("blocks constructor anywhere in a dot path", () => {
      const result = renderTemplate("{{input.constructor.name}}", {
        input: { safe: "value" },
      });
      expect(result).toBe("");
    });

    it("does NOT block keys that merely contain the word proto (not exact)", () => {
      const result = renderTemplate("{{myproto}}", { myproto: "fine" });
      expect(result).toBe("fine");
    });
  });

  // ── Real-world discussion prompt patterns ────────────────────

  describe("discussion prompt rendering", () => {
    it("renders a full discussion-turn prompt correctly", () => {
      const template =
        "You are {{agentName}}.\nDiscussion topic: {{input.topic}}\nTranscript:\n{{transcript}}\nRound: {{round}}\nRespond now.";
      const context = {
        agentName: "Agent A",
        input: { topic: "Climate change" },
        transcript: "[Round 1] Agent B: Hello\n",
        round: 2,
      };

      const result = renderTemplate(template, context);

      expect(result).toContain("You are Agent A.");
      expect(result).toContain("Discussion topic: Climate change");
      expect(result).toContain("[Round 1] Agent B: Hello");
      expect(result).toContain("Round: 2");
    });

    it("leaves unresolved placeholders as empty string (not the original {{...}})", () => {
      const result = renderTemplate("Hello {{unknown}}!", {});
      expect(result).toBe("Hello !");
    });
  });
});
