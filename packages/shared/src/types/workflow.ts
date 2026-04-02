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
  systemPrompt?: string;
  model?: string;
  ollamaModel?: string;
  /** OpenAI-compatible provider ID (references a provider in settings) */
  providerId?: string;
  /** Model name for OpenAI-compatible providers (e.g. "gpt-4o", "claude-3-opus") */
  openaiModel?: string;
  thinking?: boolean;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

/** Agent config with resolved tools from connected tool nodes on the canvas */
export interface ResolvedAgentConfig extends AgentConfig {
  allowedTools: string[];
  mcpServers: string[];
  knowledgeBases: string[];
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
}

export interface PromptConfig {
  description?: string;
}

export interface OutputConfig {
  type: OutputType;
  chatId?: string;
  config: Record<string, unknown>;
}

export interface FileConfig {
  path: string;
}

export interface ToolConfig {
  /** "builtin" for Claude Code tools, "mcp" for MCP servers, "knowledge" for KBs */
  toolType: "builtin" | "mcp" | "knowledge";
  /** The tool identifier (e.g. "Bash", "playwright", or KB ID as string) */
  toolId: string;
  /** Display name */
  toolName: string;
}

// Keep backward compat alias
export type TransformConfig = CodeConfig;

export type WorkflowNodeConfig =
  | TriggerConfig
  | AgentConfig
  | ConditionConfig
  | CodeConfig
  | MergeConfig
  | PromptConfig
  | OutputConfig
  | FileConfig
  | ToolConfig;

// ── Node Data ────────────────────────────────────────────────

export interface WorkflowNodeData {
  [key: string]: unknown;
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
  targetHandle?: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  toolName?: string;
  inputSchema?: Record<string, unknown>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
