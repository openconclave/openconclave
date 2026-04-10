import type { RunStatus, TaskStatus } from "./conclave";

export type { TaskStatus, RunStatus };

export interface AgentTask {
  id: number;
  runId: number;
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
  id: number;
  conclaveId: number;
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
  runId: number;
  nodeId?: string;
  type: string;
  data?: unknown;
  createdAt: string;
}
