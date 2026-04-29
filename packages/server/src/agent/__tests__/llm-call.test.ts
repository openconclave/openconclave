import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import type { RunEvent } from "../../engine/types";

// ── In-memory DB mock ────────────────────────────────────────

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA foreign_keys = OFF");
sqlite.exec(
  `CREATE TABLE agent_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
   node_id TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL,
   system_prompt TEXT, model TEXT DEFAULT 'sonnet', input TEXT, output TEXT,
   error TEXT, tokens_used INTEGER, cost_usd REAL,
   started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL)`,
);
sqlite.exec(
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
);

const testDb = drizzle(sqlite);
mock.module("../../db/client", () => ({ db: testDb }));

// ── DNS mock (override per test) ─────────────────────────────

let dnsLookupImpl: (
  hostname: string,
  options?: unknown,
) => Promise<Array<{ address: string; family: number }>> = async () => [
  { address: "93.184.216.34", family: 4 },
];

mock.module("node:dns/promises", () => ({
  lookup: (hostname: string, options?: unknown) => dnsLookupImpl(hostname, options),
}));

// ── Claude SDK mock ──────────────────────────────────────────

interface CapturedTool {
  name: string;
  cb: (args: Record<string, unknown>) => Promise<unknown>;
}

let capturedTools: CapturedTool[] = [];
let capturedQueryOptions: { abortController?: AbortController; maxTurns?: number } | undefined;
let queryYieldCount = 0;

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (cfg: { name: string }) => cfg,
  tool: (
    name: string,
    _desc: string,
    _shape: unknown,
    cb: (args: Record<string, unknown>) => Promise<unknown>,
  ) => {
    capturedTools.push({ name, cb });
    return { name };
  },
  query: (cfg: { options: { abortController?: AbortController; maxTurns?: number } }) => {
    capturedQueryOptions = cfg.options;
    return (async function* () {
      while (true) {
        if (capturedQueryOptions?.abortController?.signal.aborted) return;
        yield { type: "assistant" };
        queryYieldCount++;
        if (queryYieldCount === 1 && capturedTools[0]) {
          await capturedTools[0].cb({ tool_arg: "value" });
        }
        const limit = capturedQueryOptions?.maxTurns ?? 3;
        if (queryYieldCount >= limit) {
          throw new Error(`Reached maximum number of turns (${limit})`);
        }
      }
    })();
  },
}));

mock.module("../runtime", () => ({
  getCliPath: () => "/fake/cli",
  isAllowedModel: () => true,
}));

mock.module("../subprocess-env", () => ({
  buildSubprocessEnv: () => ({}),
}));

const { invokeWithTools, isPublicHttpUrl } = await import("../llm-call");

// ── Helpers ──────────────────────────────────────────────────

const now = new Date().toISOString();

function clearDb() {
  sqlite.exec("DELETE FROM agent_tasks");
  sqlite.exec("DELETE FROM settings");
  capturedTools = [];
  capturedQueryOptions = undefined;
  queryYieldCount = 0;
  dnsLookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
}

function makeConfig(overrides: Partial<ResolvedAgentConfig> = {}): ResolvedAgentConfig {
  return {
    label: "test",
    type: "agent",
    engine: "claude",
    systemPrompt: "sys",
    ...overrides,
  } as ResolvedAgentConfig;
}

function captureEvents(): { events: RunEvent[]; emit: (e: RunEvent) => void } {
  const events: RunEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

let origFetch: typeof globalThis.fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFetch(impl: (...args: any[]) => any): void {
  globalThis.fetch = impl as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = origFetch;
}

// ── MINOR: 0.0.0.0/8 and CGNAT 100.64.0.0/10 ─────────────────

describe("isPublicHttpUrl: 0.0.0.0/8 and CGNAT blocklists", () => {
  test("rejects 0.0.0.0/8 (any 0.x.y.z)", () => {
    expect(isPublicHttpUrl("https://0.0.0.1/")).toBe(false);
    expect(isPublicHttpUrl("https://0.255.255.254/")).toBe(false);
    expect(isPublicHttpUrl("https://0.1.2.3/")).toBe(false);
  });

  test("rejects CGNAT 100.64.0.0/10", () => {
    expect(isPublicHttpUrl("https://100.64.0.1/")).toBe(false);
    expect(isPublicHttpUrl("https://100.127.255.255/")).toBe(false);
    expect(isPublicHttpUrl("https://100.100.100.100/")).toBe(false);
  });

  test("still allows 100.x outside CGNAT", () => {
    expect(isPublicHttpUrl("https://100.63.255.255/")).toBe(true);
    expect(isPublicHttpUrl("https://100.128.0.1/")).toBe(true);
  });
});

// Bun's WHATWG URL parser normalizes octal / decimal-integer / short-form
// IPv4 to canonical dotted-decimal before the regex inspects .hostname, so
// the existing numeric-octet blocklist already catches these forms — no
// extra canonicalization code is needed. These tests lock in that behavior.
describe("isPublicHttpUrl: alternate IPv4 encodings are blocked via URL normalization", () => {
  test("octal first-octet form is blocked (0177 → 127)", () => {
    expect(isPublicHttpUrl("https://0177.0.0.1/")).toBe(false);
  });

  test("pure-decimal IPv4 is blocked (2130706433 → 127.0.0.1)", () => {
    expect(isPublicHttpUrl("https://2130706433/")).toBe(false);
  });

  test("short-form IPv4 is blocked (127.1 → 127.0.0.1)", () => {
    expect(isPublicHttpUrl("https://127.1/")).toBe(false);
  });

  test("decimal cloud-metadata address is blocked (2852039166 → 169.254.169.254)", () => {
    expect(isPublicHttpUrl("https://2852039166/")).toBe(false);
  });

  test("hex-octet form is blocked (0x7f → 127)", () => {
    expect(isPublicHttpUrl("https://0x7f.0.0.1/")).toBe(false);
  });
});

// ── MAJOR: invokeOllama validates non-object tool arguments ──

describe("invokeOllama: tool argument type validation", () => {
  beforeEach(() => {
    clearDb();
    origFetch = globalThis.fetch;
  });
  afterEach(() => { restoreFetch(); });

  test("rejects null arguments rather than passing null downstream", async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({
        message: {
          tool_calls: [{ function: { name: "vote", arguments: null } }],
        },
      }),
    } as unknown as Response));

    const { events, emit } = captureEvents();
    await expect(invokeWithTools({
      engine: "ollama",
      config: makeConfig({ engine: "ollama", ollamaModel: "qwen3:8b" }),
      prompt: "hi",
      tools: [{ name: "vote", description: "d", input_schema: { type: "object" } }],
      runId: 1,
      nodeId: "n1",
      emit,
    })).rejects.toThrow(/tool arguments/i);

    expect(events.some((e) => e.type === "agent:completed" && (e.data as { success?: boolean }).success === false)).toBe(true);
  });

  test("rejects array arguments rather than treating them as a record", async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({
        message: {
          tool_calls: [{ function: { name: "vote", arguments: [] } }],
        },
      }),
    } as unknown as Response));

    const { emit } = captureEvents();
    await expect(invokeWithTools({
      engine: "ollama",
      config: makeConfig({ engine: "ollama", ollamaModel: "qwen3:8b" }),
      prompt: "hi",
      tools: [{ name: "vote", description: "d", input_schema: { type: "object" } }],
      runId: 1,
      nodeId: "n1",
      emit,
    })).rejects.toThrow(/tool arguments/i);
  });
});

// ── MINOR: invokeOpenAI rejects zero choices ─────────────────

describe("invokeOpenAI: zero choices in response", () => {
  beforeEach(() => {
    clearDb();
    origFetch = globalThis.fetch;
    sqlite
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("provider:p1", JSON.stringify({ baseUrl: "https://api.example.com/v1", apiKey: "k" }), now);
  });
  afterEach(() => { restoreFetch(); });

  test("throws rather than silently returning empty success when choices is []", async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({ choices: [] }),
    } as unknown as Response));

    const { emit } = captureEvents();
    await expect(invokeWithTools({
      engine: "openai",
      config: makeConfig({ engine: "openai", providerId: "p1", openaiModel: "gpt-4o" }),
      prompt: "hi",
      tools: [],
      runId: 1,
      nodeId: "n1",
      emit,
    })).rejects.toThrow(/no choices/i);
  });
});

// ── MINOR: providerSchema rejects http:// (plaintext) ────────

describe("providerSchema: requires https", () => {
  beforeEach(() => {
    clearDb();
    origFetch = globalThis.fetch;
  });
  afterEach(() => { restoreFetch(); });

  test("rejects http:// baseUrl to prevent plaintext API-key transmission", async () => {
    sqlite
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("provider:p1", JSON.stringify({ baseUrl: "http://api.example.com/v1", apiKey: "k" }), now);

    let fetchCalled = false;
    setFetch(async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } as unknown as Response; });

    const { emit } = captureEvents();
    await expect(invokeWithTools({
      engine: "openai",
      config: makeConfig({ engine: "openai", providerId: "p1", openaiModel: "gpt-4o" }),
      prompt: "hi",
      tools: [],
      runId: 1,
      nodeId: "n1",
      emit,
    })).rejects.toThrow();

    expect(fetchCalled).toBe(false);
  });
});

// ── MINOR: DNS rebinding guard ───────────────────────────────

describe("invokeOpenAI: DNS rebinding guard", () => {
  beforeEach(() => {
    clearDb();
    origFetch = globalThis.fetch;
    sqlite
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run(
        "provider:p1",
        JSON.stringify({ baseUrl: "https://exfil.attacker.example/v1", apiKey: "secret" }),
        now,
      );
  });
  afterEach(() => { restoreFetch(); });

  test("rejects when hostname resolves to cloud-metadata IP", async () => {
    dnsLookupImpl = async () => [{ address: "169.254.169.254", family: 4 }];

    let fetchCalled = false;
    setFetch(async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } as unknown as Response; });

    const { emit } = captureEvents();
    await expect(invokeWithTools({
      engine: "openai",
      config: makeConfig({ engine: "openai", providerId: "p1", openaiModel: "gpt-4o" }),
      prompt: "hi",
      tools: [],
      runId: 1,
      nodeId: "n1",
      emit,
    })).rejects.toThrow(/non-public|private|metadata|resolves/i);

    expect(fetchCalled).toBe(false);
  });

  test("rejects when hostname resolves to RFC1918 IP", async () => {
    dnsLookupImpl = async () => [{ address: "10.0.0.5", family: 4 }];

    let fetchCalled = false;
    setFetch(async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } as unknown as Response; });

    const { emit } = captureEvents();
    await expect(invokeWithTools({
      engine: "openai",
      config: makeConfig({ engine: "openai", providerId: "p1", openaiModel: "gpt-4o" }),
      prompt: "hi",
      tools: [],
      runId: 1,
      nodeId: "n1",
      emit,
    })).rejects.toThrow();

    expect(fetchCalled).toBe(false);
  });
});

// ── MINOR: failure-path DB update does not mask original error

describe("invokeWithTools: failure-path DB update does not mask original error", () => {
  beforeEach(() => {
    clearDb();
    origFetch = globalThis.fetch;
  });
  afterEach(() => { restoreFetch(); });

  test("when engine throws and the failure-path db.update also throws, the engine error propagates", async () => {
    setFetch(async () => { throw new Error("ECONNRESET upstream"); });

    // Spy on testDb.update — first call (failure-path update inside the catch) throws.
    const updateSpy = spyOn(testDb, "update").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });

    try {
      const { emit } = captureEvents();
      await expect(invokeWithTools({
        engine: "ollama",
        config: makeConfig({ engine: "ollama", ollamaModel: "qwen3:8b" }),
        prompt: "hi",
        tools: [{ name: "vote", description: "d", input_schema: { type: "object" } }],
        runId: 1,
        nodeId: "n1",
        emit,
      })).rejects.toThrow(/ECONNRESET upstream/);
    } finally {
      updateSpy.mockRestore();
    }
  });
});

// ── MAJOR: success-path DB failure emits agent:completed{success:false}

describe("invokeWithTools: success-path DB failure surfaces a completion event", () => {
  beforeEach(() => {
    clearDb();
    origFetch = globalThis.fetch;
  });
  afterEach(() => { restoreFetch(); });

  test("if the success-path db.update throws, agent:completed{success:false} is emitted before rethrow", async () => {
    setFetch(async () => ({
      ok: true,
      json: async () => ({ message: { content: "ok" } }),
    } as unknown as Response));

    // First update call is the success-path update — make it throw.
    const updateSpy = spyOn(testDb, "update").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });

    const { events, emit } = captureEvents();
    try {
      await expect(invokeWithTools({
        engine: "ollama",
        config: makeConfig({ engine: "ollama", ollamaModel: "qwen3:8b" }),
        prompt: "hi",
        tools: [],
        runId: 1,
        nodeId: "n1",
        emit,
      })).rejects.toThrow();
    } finally {
      updateSpy.mockRestore();
    }

    expect(events.some((e) => e.type === "agent:completed" && (e.data as { success?: boolean }).success === false)).toBe(true);
  });
});

// ── MAJOR: Claude tool callback aborts the inner controller ──

describe("invokeClaude: aborts the SDK after the first tool call", () => {
  beforeEach(() => { clearDb(); });

  test("first tool call records state and aborts; agent:completed{success:true} is emitted", async () => {
    // TEST_LIMITATION: the real SDK controls turn accounting; our mock yields
    // until aborted. Pre-fix: no abort, mock throws "Reached maximum number of
    // turns (3)". Post-fix: tool callback aborts inner controller, mock exits
    // cleanly, toolState surfaces as success.
    const { events, emit } = captureEvents();
    const result = await invokeWithTools({
      engine: "claude",
      config: makeConfig({ engine: "claude", model: "sonnet" }),
      prompt: "hi",
      tools: [{ name: "vote", description: "d", input_schema: { type: "object", properties: { tool_arg: { type: "string" } } } }],
      runId: 1,
      nodeId: "n1",
      emit,
    });

    expect(result.tool_call?.name).toBe("vote");
    expect(result.tool_call?.input).toEqual({ tool_arg: "value" });
    expect(events.some((e) => e.type === "agent:completed" && (e.data as { success?: boolean }).success === true)).toBe(true);
    expect(capturedQueryOptions?.abortController?.signal.aborted).toBe(true);
  });
});
