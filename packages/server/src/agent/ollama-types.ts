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

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  models: string[];
};

// ── Runtime options ──────────────────────────────────────────

export type OllamaRunOptions = {
  model: string;
  prompt: string;
  systemPrompt?: string;
  input?: unknown;
  tools?: string[];
  mcpServers?: string[];
  routeTargets?: Array<{ nodeId: string; label: string; type: string }>;
  cwd?: string;
  sessionFile?: string;
  thinking?: boolean;
  maxTurns?: number;
  abortSignal?: AbortSignal;
  onOutput?: (chunk: string) => void;
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
