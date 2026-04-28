import { describe, test, expect } from "bun:test";
import { clampLimit, formatError } from "../web-search";
import { WebSearchNotConfiguredError, WebSearchTimeoutError } from "../../../web-search/search";

describe("clampLimit: null/undefined default", () => {
  test("null returns DEFAULT_LIMIT (5)", () => {
    expect(clampLimit(null)).toBe(5);
  });

  test("undefined returns DEFAULT_LIMIT (5)", () => {
    expect(clampLimit(undefined)).toBe(5);
  });

  test("valid number within bounds is returned as-is", () => {
    expect(clampLimit(3)).toBe(3);
  });

  test("below-min value is clamped to 1", () => {
    expect(clampLimit(0)).toBe(1);
  });

  test("above-max value is clamped to 10", () => {
    expect(clampLimit(99)).toBe(10);
  });
});

describe("formatError: WebSearchNotConfiguredError", () => {
  test("instanceof check returns the setup prompt regardless of message wording", () => {
    const err = new WebSearchNotConfiguredError();
    const result = formatError(err, "test query");
    expect(result).toContain("Open Settings");
    expect(result).not.toContain("Web search failed:");
  });
});

describe("formatError: WebSearchTimeoutError", () => {
  test("instanceof check returns the timeout message", () => {
    const err = new WebSearchTimeoutError(10);
    const result = formatError(err, "test query");
    expect(result).toContain("timed out");
    expect(result).not.toContain("Web search failed:");
  });
});

describe("formatError: ECONNREFUSED (code-based detection, no string fallback)", () => {
  test("err.code = ECONNREFUSED returns connection refused message", () => {
    const err = Object.assign(new Error("raw error text"), { code: "ECONNREFUSED" });
    expect(formatError(err, "q")).toContain("refused the connection");
  });

  test("err.cause.code = ECONNREFUSED is also detected", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const err = Object.assign(new Error("fetch failed"), { cause });
    expect(formatError(err, "q")).toContain("refused the connection");
  });
});

describe("formatError: ENOTFOUND (code-based detection, no string fallback)", () => {
  test("err.code = ENOTFOUND returns host resolution message", () => {
    const err = Object.assign(new Error("raw error text"), { code: "ENOTFOUND" });
    expect(formatError(err, "q")).toContain("resolve the host");
  });

  test("err.cause.code = ENOTFOUND is also detected", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    const err = Object.assign(new Error("fetch failed"), { cause });
    expect(formatError(err, "q")).toContain("resolve the host");
  });
});
