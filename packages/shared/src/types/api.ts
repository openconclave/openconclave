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

// ── Import / Export ─────────────────────────────────────────

export type ConclaveExportRole = {
  id: string;
  label: string;
  original: {
    engine?: string;
    model?: string;
    ollamaModel?: string;
    providerId?: string;
    openaiModel?: string;
  };
  nodeIds: string[];
};

export type ConclaveExportKB = {
  originalId: string;
  name: string;
  description?: string;
};

export type ConclaveExportPayload = {
  formatVersion: 1;
  ocVersion: string;
  exportedAt: string;
  conclave: {
    name: string;
    description?: string;
    toolName?: string;
    version?: string;
    nodes: ConclaveDefinition["nodes"];
    edges: ConclaveDefinition["edges"];
  };
  roles: ConclaveExportRole[];
  knowledgeBases: ConclaveExportKB[];
};

export type ConclaveImportRequest = {
  payload: ConclaveExportPayload;
  roleMappings: Record<string, {
    engine?: string;
    model?: string;
    ollamaModel?: string;
    providerId?: string;
    openaiModel?: string;
  }>;
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
