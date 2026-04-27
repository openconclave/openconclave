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
  workingDirectory: z.string().optional(),
  prompt: z.string().optional(),
  cron: z.string().optional(),
  webhookPath: z.string().optional(),
  chatId: z.string().optional(),
  allowFromUsers: z.array(z.string()).optional(),
});

const mcpServerLaunchConfigSchema = z.object({
  registryName: z.string(),
  package: z.object({
    registryType: z.enum(["npm", "pypi", "oci"]),
    identifier: z.string(),
    version: z.string().optional(),
    runtimeHint: z.string().optional(),
    environmentVariables: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      isRequired: z.boolean(),
      isSecret: z.boolean(),
    })).optional(),
    packageArguments: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      isRequired: z.boolean(),
      type: z.enum(["named", "positional"]),
    })).optional(),
  }).optional(),
  remote: z.object({
    type: z.enum(["streamable-http", "sse"]),
    url: z.string(),
  }).optional(),
  envValues: z.record(z.string()).optional(),
  argValues: z.record(z.string()).optional(),
}).passthrough();

const toolConfigSchema = z.object({
  toolType: z.enum(["builtin", "mcp", "knowledge"]),
  toolId: z.string(),
  toolName: z.string(),
  mcpLaunchConfig: mcpServerLaunchConfigSchema.optional(),
});

export const agentConfigSchema = z.object({
  engine: z.enum(AGENT_ENGINES).optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  ollamaModel: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
  debugResponse: z.string().optional(),
  tools: z.array(toolConfigSchema).optional(),
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

export const discussionConfigSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  moderator: z
    .object({
      type: z.enum(["code", "agent"]),
      node: z.object({
        label: z.string(),
        // Support both "transform" (legacy) and "code" (current) for backward compatibility
        type: z.enum(["transform", "code", "agent"]),
        config: z.record(z.unknown()),
      }),
    })
    .optional(),
  tool: z
    .object({
      name: z.string(),
      description: z.string(),
      schema: z.record(z.unknown()),
    })
    .optional(),
  // Hard cap: prevents user-configurable DoS. Document ≤10 for stable operation.
  maxRounds: z.number().int().min(1).max(100),
  // filter intentionally absent — new Function() sandbox bypass (CVE-2026-25049)
});

export const conclaveNodeSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    label: z.string(),
    type: z.enum(NODE_TYPES),
    config: z.record(z.unknown()),
  }),
});

export const conclaveEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
});

export const createConclaveSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  toolName: z.string().max(50).optional(),
  nodes: z.array(conclaveNodeSchema),
  edges: z.array(conclaveEdgeSchema),
});

export const updateConclaveSchema = createConclaveSchema.partial().extend({
  enabled: z.boolean().optional(),
});

const importRoleValueSchema = z.object({
  engine: z.string().optional(),
  model: z.string().optional(),
  ollamaModel: z.string().optional(),
  providerId: z.string().optional(),
  openaiModel: z.string().optional(),
});

const exportPayloadSchema = z.object({
  formatVersion: z.literal(1),
  ocVersion: z.string(),
  exportedAt: z.string(),
  conclave: z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    toolName: z.string().optional(),
    version: z.string().optional(),
    nodes: z.array(conclaveNodeSchema),
    edges: z.array(conclaveEdgeSchema),
  }),
  roles: z.array(z.object({
    id: z.string(),
    label: z.string(),
    original: importRoleValueSchema,
    nodeIds: z.array(z.string()),
  })),
  knowledgeBases: z.array(z.object({
    originalId: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })),
});

export const importConclaveSchema = z.object({
  payload: exportPayloadSchema,
  roleMappings: z.record(importRoleValueSchema).default({}),
});
