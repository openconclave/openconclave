export const MAX_CONCLAVE_ITERATIONS = 100;
export const DEFAULT_AGENT_MAX_TURNS = 25;
export const DEFAULT_AGENT_MAX_BUDGET_USD = 1.0;
export const DEFAULT_AGENT_POOL_SIZE = 3;
export const DEFAULT_CODE_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_CODE_INPUT_MAX_BYTES = 1 * 1024 * 1024;
export const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

export const CRON_CHECK_INTERVAL_MS = 15_000;
export const CRON_SYNC_INTERVAL_MS = 60_000;
export const TELEGRAM_POLL_TIMEOUT_S = 30;

export const API_PORT = 4000;
export const CLIENT_PORT = 5173;

export const NODE_TYPES = ["trigger", "agent", "condition", "code", "merge", "prompt", "output", "file", "discussion"] as const;

/**
 * Aliases for backward compatibility with legacy node type names.
 * Maps old type names to their current equivalents.
 * Support for legacy types can be removed after a deprecation period.
 */
export const NODE_TYPE_ALIASES = {
  "transform": "code"
} as const;
export const TRIGGER_TYPES = ["manual", "cron", "webhook", "channel", "telegram", "chat"] as const;
export const AGENT_ENGINES = ["claude", "ollama", "openai", "debug"] as const;
export const CODE_RUNTIMES = ["python", "node", "bash"] as const;
export const OUTPUT_TYPES = ["log", "claude-code", "telegram"] as const;
export const RUN_STATUSES = ["queued", "running", "success", "failure", "cancelled", "interrupted"] as const;
