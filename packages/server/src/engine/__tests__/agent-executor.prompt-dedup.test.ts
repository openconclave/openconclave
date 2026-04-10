/**
 * Regression tests: duplicate ask_user tool injection when multiple edges
 * connect the same agent node to the same prompt node.
 *
 * AC1: two outgoing edges to the same prompt → exactly ONE ask_user tool
 * AC2: one outgoing edge to a prompt → exactly ONE ask_user tool (no regression)
 * AC3: no edges to any prompt → extraTools is undefined
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ConclaveNode, ConclaveEdge, ResolvedAgentConfig } from "@openconclave/shared";

// ── Spy captured before mock.module so tests can assert on its calls ─────
const runOllamaAgentSpy = mock(() =>
  Promise.resolve({ success: true, output: "ok", durationMs: 0 })
);

// ── Module mocks must be registered before the dynamic import ────────────
mock.module("../../db/client", () => ({
  db: {
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([{ id: 42 }])),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve(undefined)),
      })),
    })),
  },
}));

mock.module("../../db/schema", () => ({ agentTasks: {}, settings: {} }));

mock.module("drizzle-orm", () => ({ eq: mock(() => {}) }));

mock.module("../../agent/pool", () => ({
  agentPool: {
    submit: mock(() =>
      Promise.resolve({ success: true, output: "ok", durationMs: 0 })
    ),
  },
}));

mock.module("../../agent/ollama", () => ({
  runOllamaAgent: runOllamaAgentSpy,
}));

mock.module("../../agent/openai", () => ({
  runOpenAIAgent: mock(() =>
    Promise.resolve({ success: true, output: "ok", durationMs: 0 })
  ),
}));

mock.module("../../lib/logger", () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

mock.module("../../lib/workspace", () => ({ SESSIONS_DIR: "/tmp/sessions" }));

mock.module("../prompt-registry", () => ({
  registerPrompt: mock(() => Promise.resolve("mocked-response")),
}));

// ── Import the module under test AFTER mocks are registered ──────────────
const { executeAgent } = await import("../agent-executor");

// ── Shared fixtures ───────────────────────────────────────────────────────

const agentNode: ConclaveNode = {
  id: "agent-1",
  type: "agent",
  position: { x: 0, y: 0 },
  data: {
    label: "My Agent",
    type: "agent",
    config: {},
  },
};

const promptNode: ConclaveNode = {
  id: "prompt-1",
  type: "prompt",
  position: { x: 200, y: 0 },
  data: {
    label: "My Prompt",
    type: "prompt",
    config: {},
  },
};

const nodeMap = new Map<string, ConclaveNode>([
  ["agent-1", agentNode],
  ["prompt-1", promptNode],
]);

const config: ResolvedAgentConfig = {
  engine: "ollama",
  ollamaModel: "llama3",
  allowedTools: [],
  mcpServers: [],
  knowledgeBases: [],
};

// Two edges — same source ("agent-1") and same target ("prompt-1") but different handles
const edgeA: ConclaveEdge = {
  id: "edge-a",
  source: "agent-1",
  target: "prompt-1",
  sourceHandle: "right",
  targetHandle: "left",
};

const edgeB: ConclaveEdge = {
  id: "edge-b",
  source: "agent-1",
  target: "prompt-1",
  sourceHandle: "bottom",
  targetHandle: "bottom",
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("executeAgent – prompt-node deduplication in extraTools", () => {
  beforeEach(() => {
    runOllamaAgentSpy.mockClear();
  });

  // AC1: The main regression — two parallel edges must not produce duplicate tools
  it("passes exactly one ask_user tool when two edges connect the same prompt node", async () => {
    await executeAgent(
      1,
      "agent-1",
      config,
      "hello",
      () => {},
      undefined,
      undefined,
      undefined,
      [edgeA, edgeB],
      nodeMap,
    );

    const opts = runOllamaAgentSpy.mock.calls[0][0] as { extraTools?: Array<{ tool: { function: { name: string } } }> };
    expect(opts.extraTools?.length).toBe(1);
  });

  // AC2: Regression guard — single edge must not be affected by the dedup fix
  it("passes exactly one ask_user tool when a single edge connects a prompt node", async () => {
    await executeAgent(
      1,
      "agent-1",
      config,
      "hello",
      () => {},
      undefined,
      undefined,
      undefined,
      [edgeA],
      nodeMap,
    );

    const opts = runOllamaAgentSpy.mock.calls[0][0] as { extraTools?: Array<unknown> };
    expect(opts.extraTools?.length).toBe(1);
  });

  // AC3: No prompt edges → extraTools is undefined
  it("passes undefined extraTools when no edges connect to a prompt node", async () => {
    await executeAgent(
      1,
      "agent-1",
      config,
      "hello",
      () => {},
      undefined,
      undefined,
      undefined,
      [], // no edges
      nodeMap,
    );

    const opts = runOllamaAgentSpy.mock.calls[0][0] as { extraTools?: unknown };
    expect(opts.extraTools).toBeUndefined();
  });
});
