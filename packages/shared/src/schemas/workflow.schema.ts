import { z } from "zod";

export const triggerConfigSchema = z.object({
  type: z.enum(["manual", "cron", "webhook", "channel"]),
  prompt: z.string().optional(),
  cron: z.string().optional(),
  webhookPath: z.string().optional(),
});

export const agentConfigSchema = z.object({
  engine: z.enum(["claude", "ollama"]).optional(),
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  ollamaModel: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
  allowedTools: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
});

export const conditionConfigSchema = z.object({
  expression: z.string().min(1),
});

export const transformConfigSchema = z.object({
  runtime: z.enum(["python", "node", "bash"]).default("python"),
  code: z.string().min(1),
});

export const outputConfigSchema = z.object({
  type: z.enum(["webhook", "log", "file", "notification", "claude-code"]),
  config: z.record(z.unknown()),
});

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["trigger", "agent", "condition", "transform", "output"]),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    label: z.string(),
    type: z.enum(["trigger", "agent", "condition", "transform", "output"]),
    config: z.union([
      triggerConfigSchema,
      agentConfigSchema,
      conditionConfigSchema,
      transformConfigSchema,
      outputConfigSchema,
    ]),
  }),
});

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  label: z.string().optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export const updateWorkflowSchema = createWorkflowSchema.partial().extend({
  enabled: z.boolean().optional(),
});
