import { describe, it, expect, vi, afterEach } from "vitest";

// Mock builtin-tools to avoid Bun-specific `spawn` import in Node/Vitest context.
// The ollama-tools module extends the shared builtin map — we verify the extension here.
vi.mock("./builtin-tools", () => ({
  createBuiltinTools: vi.fn(() => ({
    bash: {
      tool: { type: "function", function: { name: "bash", description: "bash", parameters: {} } },
      execute: vi.fn(),
    },
    read_file: {
      tool: { type: "function", function: { name: "read_file", description: "read", parameters: {} } },
      execute: vi.fn(),
    },
    write_file: {
      tool: { type: "function", function: { name: "write_file", description: "write", parameters: {} } },
      execute: vi.fn(),
    },
    web_fetch: {
      tool: { type: "function", function: { name: "web_fetch", description: "fetch", parameters: {} } },
      execute: vi.fn(),
    },
  })),
  TOOL_NAME_MAP: {},
}));

import { createOllamaBuiltinTools } from "../ollama-tools";

// vi.stubGlobal is not available in Bun's Vitest runner (v1.3.x).
// Assign to globalThis.fetch directly and restore after each test.
const _originalFetch = globalThis.fetch;

function mockFetch(mock: ReturnType<typeof vi.fn>): void {
  globalThis.fetch = mock as unknown as typeof globalThis.fetch;
}

describe("createOllamaBuiltinTools", () => {
  afterEach(() => {
    globalThis.fetch = _originalFetch;
    vi.restoreAllMocks();
  });

  it("includes shared tools: bash, read_file, write_file, web_fetch", () => {
    const tools = createOllamaBuiltinTools();
    expect(tools).toHaveProperty("bash");
    expect(tools).toHaveProperty("read_file");
    expect(tools).toHaveProperty("write_file");
    expect(tools).toHaveProperty("web_fetch");
  });

  it("includes send_telegram tool", () => {
    const tools = createOllamaBuiltinTools();
    expect(tools).toHaveProperty("send_telegram");
  });

  it("each tool has type 'function' and an execute function", () => {
    const tools = createOllamaBuiltinTools();
    for (const [, entry] of Object.entries(tools)) {
      expect(entry.tool.type).toBe("function");
      expect(typeof entry.tool.function.name).toBe("string");
      expect(typeof entry.tool.function.description).toBe("string");
      expect(typeof entry.tool.function.parameters).toBe("object");
      expect(typeof entry.execute).toBe("function");
    }
  });

  it("send_telegram tool has correct name and required parameters", () => {
    const tools = createOllamaBuiltinTools();
    const tg = tools.send_telegram;
    expect(tg.tool.function.name).toBe("send_telegram");
    const params = tg.tool.function.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toContain("chat_id");
    expect(params.required).toContain("text");
    expect(params.properties).toHaveProperty("chat_id");
    expect(params.properties).toHaveProperty("text");
  });

  describe("send_telegram execute", () => {
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;

    afterEach(() => {
      if (originalToken === undefined) {
        delete process.env.TELEGRAM_BOT_TOKEN;
      } else {
        process.env.TELEGRAM_BOT_TOKEN = originalToken;
      }
    });

    it("returns an error string when TELEGRAM_BOT_TOKEN is not set", async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const tools = createOllamaBuiltinTools();
      const result = await tools.send_telegram.execute({ chat_id: "123", text: "hello" });
      expect(result).toBe("Error: TELEGRAM_BOT_TOKEN not set in environment");
    });

    it("returns success message when Telegram API responds ok", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      mockFetch(vi.fn().mockResolvedValue({
        json: async () => ({ ok: true, result: { message_id: 42 } }),
      }));
      const tools = createOllamaBuiltinTools();
      const result = await tools.send_telegram.execute({ chat_id: "123", text: "hello" });
      expect(result).toBe("Message sent (id: 42)");
    });

    it("returns error message when Telegram API responds not ok", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      mockFetch(vi.fn().mockResolvedValue({
        json: async () => ({ ok: false, description: "Bad Request" }),
      }));
      const tools = createOllamaBuiltinTools();
      const result = await tools.send_telegram.execute({ chat_id: "123", text: "hello" });
      expect(result).toBe("Error: Bad Request");
    });

    it("returns error string when fetch throws", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      mockFetch(vi.fn().mockRejectedValue(new Error("Network failure")));
      const tools = createOllamaBuiltinTools();
      const result = await tools.send_telegram.execute({ chat_id: "123", text: "hello" });
      expect(result).toBe("Error: Network failure");
    });
  });
});
