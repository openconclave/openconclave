import type { RunStatus, TaskStatus } from "./workflow";

export type { TaskStatus, RunStatus };

export interface AgentTask {
  id: string;
  runId: string;
  nodeId: string;
  status: TaskStatus;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  tokensUsed?: number;
  costUsd?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface Run {
  id: string;
  workflowId: string;
  status: RunStatus;
  triggerType?: string;
  triggerPayload?: unknown;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
}

export interface RunEvent {
  id: number;
  runId: string;
  nodeId?: string;
  type: string;
  data?: unknown;
  createdAt: string;
}
