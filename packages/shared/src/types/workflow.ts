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
  /** Static response text for debug engine */
  debugResponse?: string;
  /** Tools attached to this agent (dragged onto the agent card) */
  tools?: ToolConfig[];
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

export interface DiscussionModeratorConfig {
  /** "code" = deterministic script via code.ts, "agent" = LLM-driven via invokeWithTools */
  type: "code" | "agent";
  node: {
    label: string;
    type: "transform" | "agent";
    config: CodeConfig | AgentConfig;
  };
}

export interface DiscussionConfig {
  /**
   * Prompt template rendered for each participant turn.
   * Supported variables: {{agentName}}, {{input}}, {{transcript}}, {{round}}
   * Dot notation: {{input.topic}}
   * NOTE: no `filter` field — evaluateExpression() uses new Function() (CVE-2026-25049)
   */
  prompt: string;
  moderator?: DiscussionModeratorConfig;
  /** Optional tool registration (used by workflow tool system, not the discussion loop) */
  tool?: {
    name: string;
    description: string;
    schema: Record<string, unknown>;
  };
  maxRounds: number;
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
  | DiscussionConfig;

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
