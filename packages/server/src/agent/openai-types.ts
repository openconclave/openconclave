// ── Provider config (stored in settings) ────────────────────

export interface OpenAIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** "responses" for OpenAI Responses API, "chat" for standard Chat Completions (default) */
  apiType?: "responses" | "chat";
  supportsModelList?: boolean;
}

// ── Tool definitions (same shape as Ollama tools) ───────────

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

import type { Workspace } from "../engine/workspace";

// ── Runtime options ─────────────────────────────────────────

export interface OpenAIRunOptions {
  provider: OpenAIProvider;
  model: string;
  prompt?: string;
  systemPrompt?: string;
  input?: unknown;
  tools?: OpenAITool[];
  allowedTools?: string[];
  mcpServers?: string[];
  knowledgeBases?: string[];
  workspace?: Workspace;
  routeTargets?: Array<{ nodeId: string; label: string; type: string }>;
  sessionFile?: string;
  maxTurns?: number;
  onOutput?: (chunk: string) => void;
}

export interface OpenAIResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  thinking?: Array<{ thinking: string }>;
  routeTo?: string;
  sessionId?: string;
}
