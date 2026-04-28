import { test, expect, describe } from "bun:test";
import { evaluateExpression } from "../expression";

describe("evaluateExpression", () => {
  describe("sandbox bypass rejection", () => {
    test("rejects globalThis property-chain via string-concatenation indexing", () => {
      // Verified bypass payload from security finding: allowlist passes every
      // character (\w, [], ', +) and blocklist never fires (no word-boundary
      // match on split identifiers). Pre-fix this resolves process.env via
      // globalThis and returns a truthy boolean instead of throwing.
      const payload = "globalThis['proc'+'ess']['env']['HOME']";
      expect(() => evaluateExpression(payload, {})).toThrow();
    });

    test("rejects direct process access", () => {
      expect(() => evaluateExpression("process.env.HOME", {})).toThrow();
    });

    test("rejects require via concatenation", () => {
      const payload =
        "globalThis['proc'+'ess']['mainModule']['requ'+'ire']('child_process')";
      expect(() => evaluateExpression(payload, {})).toThrow();
    });
  });

  describe("legitimate expressions", () => {
    test("numeric comparison true", () => {
      expect(evaluateExpression("input > 5", 10)).toBe(true);
    });

    test("numeric comparison false", () => {
      expect(evaluateExpression("input > 5", 3)).toBe(false);
    });

    test("string equality", () => {
      expect(evaluateExpression('input == "hello"', "hello")).toBe(true);
    });

    test("member access on input object", () => {
      expect(
        evaluateExpression('input.status == "active"', { status: "active" })
      ).toBe(true);
    });

    test("logical AND", () => {
      expect(evaluateExpression("input > 0 and input < 10", 5)).toBe(true);
    });

    test("logical OR", () => {
      expect(evaluateExpression("input < 0 or input > 100", 200)).toBe(true);
    });

    test("returns false for unmatched expression", () => {
      expect(evaluateExpression("input > 5", 2)).toBe(false);
    });

    test("contains() finds substring anywhere in string", () => {
      const trailing = "All checks complete.\n\nVERDICT:APPROVED";
      expect(evaluateExpression('contains(input, "VERDICT:APPROVED")', trailing)).toBe(true);
    });

    test("contains() returns false when substring is absent", () => {
      expect(evaluateExpression('contains(input, "X")', "no match here")).toBe(false);
    });

    test("startsWith() and endsWith() match at the boundaries", () => {
      expect(evaluateExpression('startsWith(input, "VERDICT")', "VERDICT:APPROVED")).toBe(true);
      expect(evaluateExpression('endsWith(input, "APPROVED")', "VERDICT:APPROVED")).toBe(true);
    });
  });
});
