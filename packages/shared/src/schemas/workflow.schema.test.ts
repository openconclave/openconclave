import { describe, it, expect } from "vitest";
import { createWorkflowSchema, agentConfigSchema, triggerConfigSchema } from "./workflow.schema";

describe("createWorkflowSchema", () => {
  it("validates a minimal workflow", () => {
    const result = createWorkflowSchema.safeParse({
      name: "Test",
      nodes: [],
      edges: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createWorkflowSchema.safeParse({
      name: "",
      nodes: [],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = createWorkflowSchema.safeParse({
      name: "x".repeat(101),
      nodes: [],
      edges: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("agentConfigSchema", () => {
  it("validates agent with system prompt", () => {
    const result = agentConfigSchema.safeParse({ systemPrompt: "You are helpful" });
    expect(result.success).toBe(true);
  });

  it("validates agent with all fields", () => {
    const result = agentConfigSchema.safeParse({
      engine: "ollama",
      systemPrompt: "You are helpful",
      model: "haiku",
      ollamaModel: "qwen3.5:9b",
      maxTurns: 5,
      maxBudgetUsd: 0.5,
      allowedTools: ["Bash", "Read"],
      mcpServers: ["playwright"],
    });
    expect(result.success).toBe(true);
  });

  it("validates agent with no fields (all optional)", () => {
    const result = agentConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid engine", () => {
    const result = agentConfigSchema.safeParse({
      engine: "gpt",
      prompt: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("triggerConfigSchema", () => {
  it("validates manual trigger", () => {
    const result = triggerConfigSchema.safeParse({ type: "manual" });
    expect(result.success).toBe(true);
  });

  it("validates cron trigger", () => {
    const result = triggerConfigSchema.safeParse({
      type: "cron",
      cron: "* * * * *",
    });
    expect(result.success).toBe(true);
  });

  it("validates telegram trigger with chatId", () => {
    const result = triggerConfigSchema.safeParse({
      type: "telegram",
      chatId: "1470461098",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid trigger type", () => {
    const result = triggerConfigSchema.safeParse({ type: "email" });
    expect(result.success).toBe(false);
  });
});
