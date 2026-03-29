import type { WorkflowDefinition } from "./workflow";
import type { Run, AgentTask, RunEvent } from "./agent";

export type CreateWorkflowRequest = {
  name: string;
  description?: string;
  nodes: WorkflowDefinition["nodes"];
  edges: WorkflowDefinition["edges"];
};

export type UpdateWorkflowRequest = Partial<CreateWorkflowRequest> & {
  enabled?: boolean;
};

export type WorkflowListResponse = {
  workflows: WorkflowDefinition[];
};

export type RunListResponse = {
  runs: Run[];
};

export type RunDetailResponse = {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
};

export type DashboardResponse = {
  activeRuns: number;
  totalWorkflows: number;
  recentRuns: Run[];
  agentTasks: AgentTask[];
};
