import { describe, it, expect, vi } from "vitest";

// Mock modules with Bun-specific imports (bun:sqlite) so vitest can load agent-executor
vi.mock("../db/client", () => ({ db: {} }));
vi.mock("../agent/pool", () => ({ agentPool: { submit: vi.fn() } }));
vi.mock("../agent/ollama", () => ({ runOllamaAgent: vi.fn() }));
vi.mock("../agent/openai", () => ({ runOpenAIAgent: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../lib/workspace", () => ({ SESSIONS_DIR: "/tmp/sessions" }));

// mapOllamaTools is a pure function — no external deps needed.
import { mapOllamaTools } from "../agent-executor";

import type { ResolvedAgentConfig } from "@openconclave/shared";

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<ResolvedAgentConfig> = {}): ResolvedAgentConfig {
  return { engine: "ollama", ollamaModel: "llama3", allowedTools: [], mcpServers: [], knowledgeBases: [], ...overrides };
}

// ── mapOllamaTools ────────────────────────────────────────────

describe("mapOllamaTools", () => {
  // ── No tools, no KBs ─────────────────────────────────────────

  describe("empty configuration", () => {
    it("returns empty array when no allowedTools and no knowledgeBases", () => {
      const result = mapOllamaTools(makeConfig());
      expect(result).toEqual([]);
    });

    it("returns empty array when allowedTools is empty and knowledgeBases is empty (minimal config)", () => {
      const config: ResolvedAgentConfig = { engine: "ollama", allowedTools: [], mcpServers: [], knowledgeBases: [] };
      expect(mapOllamaTools(config)).toEqual([]);
    });

    it("returns empty array when allowedTools is empty and knowledgeBases is empty", () => {
      const result = mapOllamaTools(makeConfig({ allowedTools: [], knowledgeBases: [] }));
      expect(result).toEqual([]);
    });
  });

  // ── Standard tool mapping ─────────────────────────────────────

  describe("standard tool mapping", () => {
    it("maps Bash to bash", () => {
      const result = mapOllamaTools(makeConfig({ allowedTools: ["Bash"] }));
      expect(result).toContain("bash");
    });

    it("maps Read to read_file", () => {
      const result = mapOllamaTools(makeConfig({ allowedTools: ["Read"] }));
      expect(result).toContain("read_file");
    });

    it("maps Write to write_file", () => {
      const result = mapOllamaTools(makeConfig({ allowedTools: ["Write"] }));
      expect(result).toContain("write_file");
    });

    it("maps WebFetch to web_fetch", () => {
      const result = mapOllamaTools(makeConfig({ allowedTools: ["WebFetch"] }));
      expect(result).toContain("web_fetch");
    });

    it("maps multiple standard tools in order", () => {
      const result = mapOllamaTools(
        makeConfig({ allowedTools: ["Bash", "Read", "Write", "WebFetch"] }),
      );
      expect(result).toEqual(["bash", "read_file", "write_file", "web_fetch"]);
    });

    it("silently ignores unknown tool names", () => {
      const result = mapOllamaTools(makeConfig({ allowedTools: ["Bash", "UnknownTool"] }));
      expect(result).toEqual(["bash"]);
    });

    it("returns only mapped tools when all entries are unknown", () => {
      const result = mapOllamaTools(makeConfig({ allowedTools: ["NotARealTool"] }));
      expect(result).toEqual([]);
    });
  });

  // ── knowledge tools from knowledgeBases ────────────────────────

  describe("knowledge tools from knowledgeBases", () => {
    it("adds all three knowledge tools when knowledgeBases has one entry", () => {
      const result = mapOllamaTools(makeConfig({ knowledgeBases: ["kb-1"] }));
      expect(result).toContain("search_knowledge");
      expect(result).toContain("knowledge_fetch");
      expect(result).toContain("knowledge_add");
    });

    it("adds all three knowledge tools when knowledgeBases has multiple entries", () => {
      const result = mapOllamaTools(makeConfig({ knowledgeBases: ["kb-1", "kb-2", "kb-3"] }));
      expect(result).toContain("search_knowledge");
      expect(result).toContain("knowledge_fetch");
      expect(result).toContain("knowledge_add");
    });

    it("does not add knowledge tools when knowledgeBases is empty array", () => {
      const result = mapOllamaTools(makeConfig({ knowledgeBases: [] }));
      expect(result).not.toContain("search_knowledge");
      expect(result).not.toContain("knowledge_fetch");
      expect(result).not.toContain("knowledge_add");
    });

    it("does not add knowledge tools when knowledgeBases is undefined", () => {
      const result = mapOllamaTools(makeConfig({ knowledgeBases: undefined }));
      expect(result).not.toContain("search_knowledge");
    });

    it("adds knowledge tools alongside mapped standard tools", () => {
      const result = mapOllamaTools(
        makeConfig({ allowedTools: ["Bash", "Read"], knowledgeBases: ["kb-1"] }),
      );
      expect(result).toContain("bash");
      expect(result).toContain("read_file");
      expect(result).toContain("search_knowledge");
      expect(result).toContain("knowledge_fetch");
      expect(result).toContain("knowledge_add");
    });

    it("adds each knowledge tool exactly once even with multiple KBs", () => {
      const result = mapOllamaTools(makeConfig({ knowledgeBases: ["kb-a", "kb-b"] }));
      expect(result.filter((t) => t === "search_knowledge").length).toBe(1);
      expect(result.filter((t) => t === "knowledge_fetch").length).toBe(1);
      expect(result.filter((t) => t === "knowledge_add").length).toBe(1);
    });
  });

  // ── send_telegram from mcpServers ─────────────────────────────

  describe("send_telegram from mcpServers", () => {
    it("adds send_telegram when mcpServers includes telegram-voice", () => {
      const result = mapOllamaTools(makeConfig({ mcpServers: ["telegram-voice"] }));
      expect(result).toContain("send_telegram");
    });

    it("does not add send_telegram when mcpServers is empty", () => {
      const result = mapOllamaTools(makeConfig({ mcpServers: [] }));
      expect(result).not.toContain("send_telegram");
    });

    it("does not add send_telegram when mcpServers is undefined", () => {
      const result = mapOllamaTools(makeConfig({ mcpServers: undefined }));
      expect(result).not.toContain("send_telegram");
    });

    it("does not add send_telegram when mcpServers has other entries but not telegram-voice", () => {
      const result = mapOllamaTools(makeConfig({ mcpServers: ["some-other-server"] }));
      expect(result).not.toContain("send_telegram");
    });

    it("adds send_telegram alongside other mapped tools and search_knowledge", () => {
      const result = mapOllamaTools(
        makeConfig({
          allowedTools: ["Bash"],
          mcpServers: ["telegram-voice"],
          knowledgeBases: ["kb-1"],
        }),
      );
      expect(result).toContain("bash");
      expect(result).toContain("send_telegram");
      expect(result).toContain("search_knowledge");
    });
  });

  // ── Return type and shape ─────────────────────────────────────

  describe("return type", () => {
    it("always returns an array", () => {
      expect(Array.isArray(mapOllamaTools(makeConfig()))).toBe(true);
    });

    it("all returned values are strings", () => {
      const result = mapOllamaTools(
        makeConfig({ allowedTools: ["Bash", "Read"], mcpServers: ["telegram-voice"], knowledgeBases: ["kb-1"] }),
      );
      for (const tool of result) {
        expect(typeof tool).toBe("string");
      }
    });

    it("contains no duplicates for all-tools configuration", () => {
      const result = mapOllamaTools(
        makeConfig({ allowedTools: ["Bash", "Read"], mcpServers: ["telegram-voice"], knowledgeBases: ["kb-1"] }),
      );
      const unique = new Set(result);
      expect(unique.size).toBe(result.length);
    });
  });
});
