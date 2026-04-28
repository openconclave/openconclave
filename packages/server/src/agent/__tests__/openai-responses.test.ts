import { test, expect, describe, spyOn, beforeEach, afterEach } from "bun:test";
import { runResponsesAPI } from "../openai-responses";
import { AgentBase } from "../base";
import { ROUTING_TOOL_NAME } from "../constants";
import type { OpenAIRunOptions } from "../openai-types";

const PROVIDER = { id: "t", name: "test", baseUrl: "http://localhost:0", apiKey: "k" };

function opts(o: Partial<OpenAIRunOptions> = {}): OpenAIRunOptions {
  return { provider: PROVIDER, model: "m", input: "hi", ...o };
}

// ── Shared fetch mock helpers ────────────────────────────────

let origFetch: typeof globalThis.fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFetch(impl: (...args: any[]) => any): void {
  globalThis.fetch = impl as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = origFetch;
}

// ── MAJOR: disconnect called on every exit path ──────────────

describe("runResponsesAPI: MCP bridge cleanup on every exit path", () => {
  let disconnectSpy: ReturnType<typeof spyOn<AgentBase, "disconnect">>;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    disconnectSpy = spyOn(AgentBase.prototype, "disconnect");
  });

  afterEach(() => {
    restoreFetch();
    disconnectSpy.mockRestore();
  });

  test("disconnect is called on !res.ok early-return", async () => {
    setFetch(async () => ({ ok: false, status: 500, text: async () => "err" } as unknown as Response));
    const result = await runResponsesAPI(opts());
    expect(result.success).toBe(false);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  test("disconnect is called when maxTurns is exhausted", async () => {
    // Each turn returns a function_call so hasFunctionCalls=true → continue.
    // With maxTurns:1 the loop ends and the max-turns return path is hit.
    setFetch(async () => ({
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ type: "function_call", name: "noop", call_id: "c1", arguments: "{}" }],
      }),
    } as unknown as Response));
    const result = await runResponsesAPI(opts({ maxTurns: 1 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Max turns");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  test("disconnect is called when fetch throws (catch path)", async () => {
    setFetch(async () => { throw new Error("network failure"); });
    const result = await runResponsesAPI(opts());
    expect(result.success).toBe(false);
    expect(result.error).toContain("network failure");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});

// ── MINOR: null function_call arguments must not crash ───────

describe("runResponsesAPI: null function_call arguments", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("null arguments field does not propagate a TypeError", async () => {
    // The crash only fires when name === ROUTING_TOOL_NAME because &&-short-circuit
    // skips fnArgs.node_id when the name doesn't match.
    // Pre-fix: fnArgs = null → null.node_id → TypeError (caught by outer catch)
    // Post-fix: fnArgs = {} → node_id undefined (falsy) → graceful max-turns return
    setFetch(async () => ({
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ type: "function_call", name: ROUTING_TOOL_NAME, call_id: "c1", arguments: null }],
      }),
    } as unknown as Response));
    const result = await runResponsesAPI(opts({ maxTurns: 1 }));
    // Pre-fix: error contains "Cannot read properties of null"
    expect(result.error).not.toMatch(/Cannot read properties/);
    expect(result.error).toContain("Max turns");
  });
});

// ── MINOR: onOutput called when only data.output_text is set ─

describe("runResponsesAPI: onOutput called with data.output_text fallback", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("onOutput receives data.output_text when output array has no message items", async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({
        status: "completed",
        output_text: "final answer",
        output: [],
      }),
    } as unknown as Response));
    const chunks: string[] = [];
    const result = await runResponsesAPI(opts({ onOutput: (c) => chunks.push(c) }));
    expect(result.success).toBe(true);
    expect(result.output).toBe("final answer");
    // Pre-fix: onOutput never called because textOutput is "" (falsy)
    expect(chunks).toContain("final answer");
  });
});
