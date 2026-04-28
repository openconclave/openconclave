import { describe, test, expect } from "bun:test";
import { executePrompt } from "../prompt";
import { respondToPrompt, clearPromptsForRun } from "../../prompt-registry";
import type { ConclaveDefinition, ConclaveNode } from "@openconclave/shared";
import type { RunEvent } from "../../types";

function makeNode(): ConclaveNode {
  return {
    id: "node-1",
    type: "prompt",
    position: { x: 0, y: 0 },
    data: { label: "Ask User", type: "prompt", config: {} },
  };
}

function makeConclave(): ConclaveDefinition {
  return {
    id: "c1",
    name: "test",
    nodes: [],
    edges: [],
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

// ── MAJOR: JSON.stringify(undefined) produces runtime undefined ──────────────

describe("executePrompt — MAJOR: undefined input produces blank question", () => {
  test("input === undefined emits question as empty string, not undefined", async () => {
    const runId = 7001;
    const nodeId = "prompt-undef";
    const emitted: RunEvent[] = [];

    const p = executePrompt(
      makeNode(), undefined, makeConclave(), runId, nodeId,
      null, new Map(), (e) => emitted.push(e),
    );
    respondToPrompt(runId, nodeId, "ok");
    await p;

    const evt = emitted.find(e => e.type === "prompt:question");
    expect(evt).toBeDefined();
    expect((evt!.data as { question: unknown }).question).toBe("");
  });

  test("string input passes through unchanged (not JSON-quoted)", async () => {
    const runId = 7002;
    const nodeId = "prompt-str";
    const emitted: RunEvent[] = [];

    const p = executePrompt(
      makeNode(), "what is the capital?", makeConclave(), runId, nodeId,
      null, new Map(), (e) => emitted.push(e),
    );
    respondToPrompt(runId, nodeId, "ok");
    await p;

    const data = (emitted.find(e => e.type === "prompt:question")!.data) as { question: string };
    expect(data.question).toBe("what is the capital?");
  });

  test("object input is JSON-stringified", async () => {
    const runId = 7003;
    const nodeId = "prompt-obj";
    const emitted: RunEvent[] = [];

    const p = executePrompt(
      makeNode(), { key: "value" }, makeConclave(), runId, nodeId,
      null, new Map(), (e) => emitted.push(e),
    );
    respondToPrompt(runId, nodeId, "ok");
    await p;

    const data = (emitted.find(e => e.type === "prompt:question")!.data) as { question: string };
    expect(data.question).toBe(JSON.stringify({ key: "value" }, null, 2));
  });
});

// ── MINOR: emit-before-register ordering — phantom UI prompt on duplicate ────

describe("executePrompt — MINOR: emit suppressed on duplicate registration", () => {
  test("second call on a live key does not emit prompt:question", async () => {
    const runId = 7010;
    const nodeId = "prompt-dup";

    const emittedFirst: RunEvent[] = [];
    const p1 = executePrompt(
      makeNode(), "first question", makeConclave(), runId, nodeId,
      null, new Map(), (e) => emittedFirst.push(e),
    );

    const emittedSecond: RunEvent[] = [];
    const p2 = executePrompt(
      makeNode(), "duplicate question", makeConclave(), runId, nodeId,
      null, new Map(), (e) => emittedSecond.push(e),
    );

    await expect(p2).rejects.toThrow("duplicate prompt registration");
    expect(emittedSecond.some(e => e.type === "prompt:question")).toBe(false);

    clearPromptsForRun(runId);
    await p1.catch(() => {});
  });
});
