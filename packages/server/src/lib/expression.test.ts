import { describe, it, expect } from "vitest";
import { evaluateExpression } from "./expression";

describe("evaluateExpression", () => {
  it("evaluates simple comparisons", () => {
    expect(evaluateExpression("input === 'done'", "done")).toBe(true);
    expect(evaluateExpression("input === 'done'", "continue")).toBe(false);
  });

  it("evaluates string includes", () => {
    expect(
      evaluateExpression(
        'typeof input === "string" && input.includes("done")',
        "task is done"
      )
    ).toBe(true);
  });

  it("evaluates numeric comparisons", () => {
    expect(evaluateExpression("input > 5", 10)).toBe(true);
    expect(evaluateExpression("input > 5", 3)).toBe(false);
  });

  it("evaluates object property access", () => {
    expect(evaluateExpression("input.status === 'ok'", { status: "ok" })).toBe(true);
    expect(evaluateExpression("input.count >= 4", { count: 4 })).toBe(true);
  });

  it("returns false for undefined input", () => {
    expect(evaluateExpression("input === 'test'", undefined)).toBe(false);
  });

  it("handles truthy/falsy", () => {
    expect(evaluateExpression("input", "hello")).toBe(true);
    expect(evaluateExpression("input", "")).toBe(false);
    expect(evaluateExpression("input", 0)).toBe(false);
    expect(evaluateExpression("input", null)).toBe(false);
  });

  // Security tests
  it("blocks import keyword", () => {
    expect(() => evaluateExpression('import("fs")', "")).toThrow("blocked keyword");
  });

  it("blocks require keyword", () => {
    expect(() => evaluateExpression('require("fs")', "")).toThrow("blocked keyword");
  });

  it("blocks eval", () => {
    expect(() => evaluateExpression('eval("1+1")', "")).toThrow("blocked keyword");
  });

  it("blocks process access", () => {
    expect(() => evaluateExpression("process.exit()", "")).toThrow("blocked keyword");
  });

  it("blocks Function constructor", () => {
    expect(() => evaluateExpression('Function("return 1")()', "")).toThrow("blocked keyword");
  });

  it("blocks prototype pollution", () => {
    expect(() => evaluateExpression("input.__proto__", {})).toThrow("blocked keyword");
    expect(() => evaluateExpression("input.constructor", {})).toThrow("blocked keyword");
  });
});
