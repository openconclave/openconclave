import type { WorkflowDefinition, McpServerLaunchConfig } from "./workflow";
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

export type CheckpointInfo = {
  /** IDs of nodes that completed successfully before the failure */
  completedNodes: string[];
  createdAt: string;
};

export type RunDetailResponse = {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
  checkpoint?: CheckpointInfo | null;
};

export type DashboardResponse = {
  activeRuns: number;
  totalWorkflows: number;
  recentRuns: Run[];
  agentTasks: AgentTask[];
};

// ── MCP Registry ────────────────────────────────────────────

export type McpRegistryServer = {
  /** Registry server name (reverse-DNS, e.g. "io.github.foo/bar") */
  name: string;
  /** Human-readable title */
  title: string;
  /** Short description */
  description: string;
  /** Icon URL (first available) */
  iconUrl?: string;
  /** Repo URL */
  repositoryUrl?: string;
  /** Launch config derived from registry package/remote info */
  launchConfig: McpServerLaunchConfig;
};

export type McpRegistrySearchResponse = {
  servers: McpRegistryServer[];
  nextCursor?: string;
};
