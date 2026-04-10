import type { ConclaveDefinition, McpServerLaunchConfig } from "./conclave";
import type { Run, AgentTask, RunEvent } from "./agent";

export type CreateConclaveRequest = {
  name: string;
  description?: string;
  nodes: ConclaveDefinition["nodes"];
  edges: ConclaveDefinition["edges"];
};

export type UpdateConclaveRequest = Partial<CreateConclaveRequest> & {
  enabled?: boolean;
};

export type ConclaveListResponse = {
  conclaves: ConclaveDefinition[];
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
  totalConclaves: number;
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
