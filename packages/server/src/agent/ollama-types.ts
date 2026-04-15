// ── Tool definition shape ────────────────────────────────────

export type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// ── Status check ─────────────────────────────────────────────

export type OllamaModelInfo = {
  name: string;
  capabilities: string[];
};

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  models: string[];
  modelDetails?: OllamaModelInfo[];
};

// ── Runtime options ──────────────────────────────────────────

import type { Workspace } from "../engine/workspace";
import type { ToolConfig } from "@openconclave/shared";

export type OllamaRunOptions = {
  model: string;
  prompt: string;
  systemPrompt?: string;
  input?: unknown;
  allowedTools?: string[];
  knowledgeBases?: string[];
  mcpServers?: string[];
  /** Full tool configs for registry-sourced MCP servers */
  mcpTools?: ToolConfig[];
  routeTargets?: Array<{ nodeId: string; label: string; type: string }>;
  /** Dynamic tools injected by the executor (e.g., ask_user for channel loops) */
  extraTools?: Array<{
    tool: OllamaTool;
    execute: (args: Record<string, unknown>) => Promise<string>;
  }>;
  workspace?: Workspace;
  sessionFile?: string;
  thinking?: boolean;
  maxTurns?: number;
  abortSignal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  runId?: number;
};

// ── Result types ─────────────────────────────────────────────

export interface ThinkingBlock {
  thinking: string;
}

export interface OllamaResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  thinking?: ThinkingBlock[];
  sessionId?: string;
  routeTo?: string;
}
