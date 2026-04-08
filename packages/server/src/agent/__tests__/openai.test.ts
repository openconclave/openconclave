import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Bun-specific modules before any import resolves them.
// builtin-tools and mcp-bridge use `import { spawn } from "bun"` which is
// unavailable in the Vitest/Node.js environment.
vi.mock("./builtin-tools", () => ({
  createBuiltinTools: vi.fn(() => ({})),
  TOOL_NAME_MAP: {},
}));

vi.mock("./mcp-bridge", () => ({
  McpBridge: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    getTools: vi.fn().mockReturnValue([]),
    callTool: vi.fn().mockResolvedValue(""),
    disconnect: vi.fn().mockResolvedValue(undefined),
    hasTools: vi.fn().mockReturnValue(false),
  })),
}));

import { runOpenAIAgent, listOpenAIModels } from "../openai";
import type { OpenAIProvider, OpenAIRunOptions } from "../openai";

// ── Shared test fixtures ─────────────────────────────────────

const chatProvider: OpenAIProvider = {
  id: "test-provider",
  name: "Test Provider",
  baseUrl: "https://api.test.com/v1",
  apiKey: "sk-test",
  // apiType defaults to "chat"
};

const responsesProvider: OpenAIProvider = {
  ...chatProvider,
  apiType: "responses",
};

function baseOptions(overrides: Partial<OpenAIRunOptions> = {}): OpenAIRunOptions {
  return {
    provider: chatProvider,
    model: "gpt-4o",
    prompt: "Hello",
    ...overrides,
  };
}

// vi.stubGlobal is not implemented in Bun's test runner (v1.3.x).
// We assign directly to globalThis.fetch and restore in each beforeEach.
const _originalFetch = globalThis.fetch;

function mockFetch(mock: ReturnType<typeof vi.fn>): void {
  globalThis.fetch = mock as unknown as typeof globalThis.fetch;
}

// ── listOpenAIModels ─────────────────────────────────────────

describe("listOpenAIModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = _originalFetch;
  });

  it("returns sorted model IDs on success", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-3.5-turbo" }, { id: "gpt-4" }] }),
    }));
    const models = await listOpenAIModels(chatProvider);
    expect(models).toEqual(["gpt-3.5-turbo", "gpt-4", "gpt-4o"]);
  });

  it("returns empty array when response is not ok", async () => {
    mockFetch(vi.fn().mockResolvedValue({ ok: false }));
    const models = await listOpenAIModels(chatProvider);
    expect(models).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    mockFetch(vi.fn().mockRejectedValue(new Error("Network error")));
    const models = await listOpenAIModels(chatProvider);
    expect(models).toEqual([]);
  });

  it("returns empty array when data.data is missing", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));
    const models = await listOpenAIModels(chatProvider);
    expect(models).toEqual([]);
  });

  it("uses the correct endpoint and auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    mockFetch(fetchMock);
    await listOpenAIModels(chatProvider);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test.com/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } }),
    );
  });
});

// ── runOpenAIAgent — dispatcher ─────────────────────────────

describe("runOpenAIAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = _originalFetch;
  });

  it("routes to Chat Completions when apiType is undefined", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello from chat", tool_calls: null } }],
      }),
    }));

    const result = await runOpenAIAgent(baseOptions());
    expect(result.success).toBe(true);
    expect(result.output).toBe("Hello from chat");
  });

  it("routes to Chat Completions when apiType is 'chat'", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Chat output", tool_calls: null } }],
      }),
    }));

    const result = await runOpenAIAgent(baseOptions({ provider: { ...chatProvider, apiType: "chat" } }));
    expect(result.success).toBe(true);
    expect(result.output).toBe("Chat output");
  });

  it("routes to Responses API when apiType is 'responses'", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "Responses output" }] }],
      }),
    }));

    const result = await runOpenAIAgent(baseOptions({ provider: responsesProvider }));
    expect(result.success).toBe(true);
    expect(result.output).toBe("Responses output");
  });

  it("returns success: false when provider API returns an error", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    }));

    const result = await runOpenAIAgent(baseOptions());
    expect(result.success).toBe(false);
    expect(result.error).toContain("429");
  });

  it("returns success: false when fetch throws", async () => {
    mockFetch(vi.fn().mockRejectedValue(new Error("Connection refused")));
    const result = await runOpenAIAgent(baseOptions());
    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  it("result always contains durationMs", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok", tool_calls: null } }],
      }),
    }));
    const result = await runOpenAIAgent(baseOptions());
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls onOutput with the final text", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "streamed", tool_calls: null } }],
      }),
    }));
    const chunks: string[] = [];
    await runOpenAIAgent(baseOptions({ onOutput: (c) => chunks.push(c) }));
    expect(chunks).toContain("streamed");
  });

  it("respects the system prompt by including it as the first message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok", tool_calls: null } }],
      }),
    });
    mockFetch(fetchMock);

    await runOpenAIAgent(baseOptions({ systemPrompt: "You are helpful." }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
  });

  it("reaches max turns and returns an error result", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "some_tool", arguments: "{}" },
            }],
          },
        }],
      }),
    }));

    const result = await runOpenAIAgent(baseOptions({ maxTurns: 2 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Max turns");
  });
});

// ── Responses API — routing ──────────────────────────────────

describe("runOpenAIAgent (Responses API) — routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = _originalFetch;
  });

  const routes = [
    { nodeId: "node-a", label: "Option A", type: "prompt" },
    { nodeId: "node-b", label: "Option B", type: "output" },
  ];

  it("returns routeTo when openconclave_next is called", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        output: [
          {
            type: "function_call",
            name: "openconclave_next",
            call_id: "call-1",
            arguments: JSON.stringify({ node_id: "node-a", content: "Going to A" }),
          },
        ],
      }),
    }));

    const result = await runOpenAIAgent(baseOptions({
      provider: responsesProvider,
      routeTargets: routes,
    }));

    expect(result.success).toBe(true);
    expect(result.routeTo).toBe("node-a");
    expect(result.output).toBe("Going to A");
  });
});

// ── Chat Completions — routing ───────────────────────────────

describe("runOpenAIAgent (Chat) — routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = _originalFetch;
  });

  const routes = [
    { nodeId: "step-1", label: "Step 1", type: "prompt" },
    { nodeId: "step-2", label: "Step 2", type: "output" },
  ];

  it("returns routeTo when openconclave_next is called", async () => {
    mockFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-x",
              function: {
                name: "openconclave_next",
                arguments: JSON.stringify({ node_id: "step-2", content: "Done" }),
              },
            }],
          },
        }],
      }),
    }));

    const result = await runOpenAIAgent(baseOptions({ routeTargets: routes }));
    expect(result.success).toBe(true);
    expect(result.routeTo).toBe("step-2");
    expect(result.output).toBe("Done");
  });
});
