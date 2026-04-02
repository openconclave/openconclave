import { z } from "zod";
import {
  NODE_TYPES,
  TRIGGER_TYPES,
  AGENT_ENGINES,
  CODE_RUNTIMES,
  OUTPUT_TYPES,
} from "../constants";

export const triggerConfigSchema = z.object({
  type: z.enum(TRIGGER_TYPES),
  prompt: z.string().optional(),
  cron: z.string().optional(),
  webhookPath: z.string().optional(),
  chatId: z.string().optional(),
});

export const agentConfigSchema = z.object({
  engine: z.enum(AGENT_ENGINES).optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  ollamaModel: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
});

export const conditionConfigSchema = z.object({
  expression: z.string().min(1),
});

export const codeConfigSchema = z.object({
  runtime: z.enum(CODE_RUNTIMES).default("python"),
  code: z.string().min(1),
});

// Keep backward compat alias
export const transformConfigSchema = codeConfigSchema;

export const mergeConfigSchema = z.object({}).passthrough();

export const outputConfigSchema = z.object({
  type: z.enum(OUTPUT_TYPES),
  chatId: z.string().optional(),
  config: z.record(z.unknown()),
});

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    label: z.string(),
    type: z.enum(NODE_TYPES),
    config: z.record(z.unknown()),
  }),
});

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  toolName: z.string().max(50).optional(),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export const updateWorkflowSchema = createWorkflowSchema.partial().extend({
  enabled: z.boolean().optional(),
});
