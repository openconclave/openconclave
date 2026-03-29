export type NodeType = "trigger" | "agent" | "condition" | "transform" | "output";

export type TriggerConfig = {
  type: "manual" | "cron" | "webhook" | "channel" | "telegram";
  prompt?: string;
  cron?: string;
  webhookPath?: string;
  chatId?: string;
};

export type AgentEngine = "claude" | "ollama";

export type AgentConfig = {
  engine?: AgentEngine;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  ollamaModel?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  mcpServers?: string[];
};

export type ConditionConfig = {
  expression: string;
};

export type TransformConfig = {
  runtime: "python" | "node" | "bash";
  code: string;
};

export type OutputConfig = {
  type: "webhook" | "log" | "file" | "notification" | "claude-code" | "telegram";
  chatId?: string;
  config: Record<string, unknown>;
};

export type WorkflowNodeConfig =
  | TriggerConfig
  | AgentConfig
  | ConditionConfig
  | TransformConfig
  | OutputConfig;

export type WorkflowNodeData = {
  label: string;
  type: NodeType;
  config: WorkflowNodeConfig;
};

export type WorkflowNode = {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
