/**
 * RED tests for bugs identified in code review of packages/server/src/lib/template.ts
 * Each test is intentionally failing to prove the bug exists.
 * Do NOT fix the bugs here — only write tests that demonstrate the failures.
 */

import { describe, it, expect } from "vitest";
import { renderTemplate } from "../template";

// ── Bug 1: Inherited property leakage (no Object.hasOwn() guard) ──────────────
//
// The path traversal uses direct bracket indexing:
//   value = (value as Record<string, unknown>)[segment]
// UNSAFE_KEYS only blocks __proto__, constructor, prototype — but NOT other
// inherited Object.prototype properties like `toString`, `valueOf`, `hasOwnProperty`, etc.
// These resolve to native functions and leak into the rendered output.
describe("Bug 1 – inherited property leakage", () => {
  it("should return empty string for inherited 'toString' on a plain object", () => {
    // Direct index picks up Object.prototype.toString; String(fn) leaks the function source.
    const result = renderTemplate("{{obj.toString}}", { obj: {} });
    expect(result).toBe("");
    // FAILS: actual result is "function toString() { [native code] }" (or similar)
  });

  it("should return empty string for inherited 'valueOf' on a plain object", () => {
    const result = renderTemplate("{{obj.valueOf}}", { obj: {} });
    expect(result).toBe("");
    // FAILS: actual result is "function valueOf() { [native code] }"
  });

  it("should return empty string for inherited 'hasOwnProperty' on a plain object", () => {
    const result = renderTemplate("{{ctx.hasOwnProperty}}", { ctx: {} });
    expect(result).toBe("");
    // FAILS: actual result leaks the native function
  });
});

// ── Bug 2: Serialization failure on circular references ───────────────────────
//
// Line 25: if (typeof value === "object" && value !== null) return JSON.stringify(value);
// JSON.stringify throws a TypeError for circular structures. There is no try/catch,
// so the entire renderTemplate call throws instead of returning a safe fallback.
describe("Bug 2 – JSON.stringify throws on circular references", () => {
  it("should not throw when a top-level value contains a circular reference", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular; // circular reference

    // Should return some safe fallback (e.g., "" or "[Circular]"), NOT throw.
    expect(() => renderTemplate("{{obj}}", { obj: circular })).not.toThrow();
    // FAILS: throws TypeError: Converting circular structure to JSON
  });

  it("should not throw when a nested value contains a circular reference", () => {
    const inner: Record<string, unknown> = { x: 1 };
    inner.loop = inner;
    const ctx = { outer: { inner } };

    expect(() => renderTemplate("{{outer.inner}}", ctx)).not.toThrow();
    // FAILS: throws TypeError: Converting circular structure to JSON
  });
});

// ── Bug 3: Type-checking ambiguity — arrays treated as plain objects ───────────
//
// `typeof [] === "object"` is true, so the path-traversal branch enters arrays
// as if they were plain objects. This lets callers traverse numeric indices
// (e.g. {{arr.0}}) and array prototype properties (e.g. {{arr.length}}).
// A plain-object check (e.g. Object.prototype.toString.call(v) === "[object Object]")
// should be used to guard the traversal.
describe.skip("Bug 3 – arrays traversed as plain objects (INTENTIONAL)", () => {
  // SKIPPED: Array dot-path traversal (e.g. {{arr.0}}) is intentional behavior.
  // We want {{input.0}} to work for accessing array elements.
  it.skip("array numeric index traversal is by design", () => {});
});

// ── Bug 4 (SKIPPED): Template syntax limitation — hyphens/spaces in keys ──────
//
// SKIPPED: The reviewer flagged \w as not supporting hyphens or spaces.
// This is a known regex limitation, not a code defect. The reviewer explicitly
// marked it "Nice to Have" and suggested only adding documentation.
// There is no incorrect behavior to assert — the regex simply never matches
// such keys in the first place, so no substitution occurs at all.
describe("Bug 4 – template syntax limitation (hyphens/spaces)", () => {
  it.skip("should support hyphenated keys like {{my-key}}", () => {
    // SKIPPED: \\w does not match '-'. The regex never captures {{my-key}},
    // so the placeholder is left as-is rather than substituted. This is a
    // regex-scope limitation flagged for documentation only, not a runtime bug.
    const result = renderTemplate("{{my-key}}", { "my-key": "value" });
    expect(result).toBe("value");
  });
});

// ── Bug 5 (SKIPPED): Silent failure when keys are blocked or paths fail ────────
//
// SKIPPED: The existing test suite at template.test.ts already asserts that
// unresolved paths return "". This is clearly intentional design — the function
// is documented as returning "" for missing/blocked keys. One reviewer asked
// whether logging would improve debugging, but this is a subjective style
// preference, not a correctness bug. No incorrect code path exists to assert.
describe("Bug 5 – silent failure on blocked/missing paths", () => {
  it.skip("should log an error when an unsafe key is encountered", () => {
    // SKIPPED: Silent return of "" is the documented, intentional contract of
    // renderTemplate. No logging is required by design. The reviewer noted this
    // as "Error Handling Clarity" (1/1 reviewer, Nice to Have), not a bug.
  });
});
