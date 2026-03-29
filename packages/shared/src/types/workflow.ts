import type {
  NODE_TYPES,
  TRIGGER_TYPES,
  AGENT_ENGINES,
  CODE_RUNTIMES,
  OUTPUT_TYPES,
  RUN_STATUSES,
} from "../constants";

export type NodeType = (typeof NODE_TYPES)[number];
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type AgentEngine = (typeof AGENT_ENGINES)[number];
export type CodeRuntime = (typeof CODE_RUNTIMES)[number];
export type OutputType = (typeof OUTPUT_TYPES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type TaskStatus = RunStatus;

// ── Node Configs ─────────────────────────────────────────────

export interface TriggerConfig {
  type: TriggerType;
  prompt?: string;
  cron?: string;
  webhookPath?: string;
  chatId?: string;
}

export interface AgentConfig {
  engine?: AgentEngine;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  ollamaModel?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  mcpServers?: string[];
}

export interface ConditionConfig {
  expression: string;
}

export interface CodeConfig {
  runtime: CodeRuntime;
  code: string;
}

export interface MergeConfig {
  // Merge uses source node labels as keys by default
  // No config needed — it's automatic
}

export interface OutputConfig {
  type: OutputType;
  chatId?: string;
  config: Record<string, unknown>;
}

// Keep backward compat alias
export type TransformConfig = CodeConfig;

export type WorkflowNodeConfig =
  | TriggerConfig
  | AgentConfig
  | ConditionConfig
  | CodeConfig
  | MergeConfig
  | OutputConfig;

// ── Node Data ────────────────────────────────────────────────

export interface WorkflowNodeData {
  label: string;
  type: NodeType;
  config: WorkflowNodeConfig;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
