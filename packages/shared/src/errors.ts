export const ErrorCode = {
  // General
  INTERNAL: "INTERNAL",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION",
  UNAUTHORIZED: "UNAUTHORIZED",

  // Workflow
  WORKFLOW_NOT_FOUND: "WORKFLOW_NOT_FOUND",
  WORKFLOW_DISABLED: "WORKFLOW_DISABLED",
  WORKFLOW_CYCLE_DETECTED: "WORKFLOW_CYCLE_DETECTED",
  WORKFLOW_MAX_ITERATIONS: "WORKFLOW_MAX_ITERATIONS",
  WORKFLOW_NO_ENTRY: "WORKFLOW_NO_ENTRY",

  // Agent
  AGENT_FAILED: "AGENT_FAILED",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  AGENT_NO_MODEL: "AGENT_NO_MODEL",
  AGENT_POOL_FULL: "AGENT_POOL_FULL",

  // Code node
  CODE_EXECUTION_FAILED: "CODE_EXECUTION_FAILED",
  CODE_TIMEOUT: "CODE_TIMEOUT",
  CODE_INVALID_RUNTIME: "CODE_INVALID_RUNTIME",

  // Run
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  RUN_ALREADY_CANCELLED: "RUN_ALREADY_CANCELLED",

  // Trigger
  TRIGGER_NOT_FOUND: "TRIGGER_NOT_FOUND",
  TELEGRAM_NO_TOKEN: "TELEGRAM_NO_TOKEN",
  TELEGRAM_SEND_FAILED: "TELEGRAM_SEND_FAILED",

  // MCP
  MCP_CONNECTION_FAILED: "MCP_CONNECTION_FAILED",
  MCP_TOOL_FAILED: "MCP_TOOL_FAILED",

  // Ollama
  OLLAMA_NOT_RUNNING: "OLLAMA_NOT_RUNNING",
  OLLAMA_MODEL_NOT_FOUND: "OLLAMA_MODEL_NOT_FOUND",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = 500,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }

  static notFound(resource: string, id?: string): AppError {
    const msg = id ? `${resource} "${id}" not found` : `${resource} not found`;
    return new AppError(ErrorCode.NOT_FOUND, msg, 404);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(ErrorCode.VALIDATION, message, 400, details);
  }

  static internal(message: string): AppError {
    return new AppError(ErrorCode.INTERNAL, message, 500);
  }
}
