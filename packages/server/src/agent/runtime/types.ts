import type { ResolvedAgentConfig } from "@openconclave/shared";
import type { Workspace } from "../../engine/workspace";
import type { RouteTarget } from "../../engine/types";

export interface ThinkingBlock {
  thinking: string;
  signature?: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  costUsd?: number;
  durationMs: number;
  thinking?: ThinkingBlock[];
  routeTo?: string;
  sessionId?: string;
}

export type AgentRunOptions = {
  config: ResolvedAgentConfig;
  routeTargets?: RouteTarget[];
  promptConfig?: { nodeId: string; runId: number; senderNode: string; nodeLabel: string; conclaveName?: string; description?: string };
  sessionId?: string;
  input?: unknown;
  workspace?: Workspace;
  env?: Record<string, string>;
  abortController?: AbortController;
  onOutput?: (chunk: string) => void;
  runId?: number;
};
