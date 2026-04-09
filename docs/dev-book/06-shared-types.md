# Shared Types Reference

All types live in `packages/shared/src/` and are imported as `@openconclave/shared`. No build step — TypeScript-only package.

## Workflow Structure

```typescript
interface WorkflowDefinition {
  id?: number;
  name?: string;
  description?: string;       // Workflow-level instructions for Claude
  toolName?: string;           // Exported as MCP tool name
  inputSchema?: unknown;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface WorkflowNode {
  id: string;                  // e.g., "agent_1775694439021"
  type: NodeType;
  position: { x: number; y: number };
  data: {
    type: NodeType;
    label: string;             // Display name (user-editable)
    config: WorkflowNodeConfig; // Union — depends on type
  };
}

interface WorkflowEdge {
  id: string;
  source: string;              // Source node ID
  target: string;              // Target node ID
  sourceHandle?: string;       // e.g., "true", "false", "participants"
  targetHandle?: string;
  label?: string;
}
```

## Enums

```typescript
type NodeType = "trigger" | "agent" | "condition" | "code" | "merge"
              | "prompt" | "output" | "file" | "discussion";

type TriggerType = "manual" | "cron" | "webhook" | "channel" | "telegram" | "chat";

type AgentEngine = "claude" | "ollama" | "openai" | "debug";

type CodeRuntime = "python" | "node" | "bash";

type OutputType = "log" | "claude-code" | "telegram";

type RunStatus = "queued" | "running" | "success" | "failure"
               | "cancelled" | "interrupted";
```

## Node Config Types

### TriggerConfig
```typescript
interface TriggerConfig {
  type: TriggerType;
  workingDirectory?: string;   // CWD for the run
  prompt?: string;             // Input prompt for manual/chat triggers
  cron?: string;               // 5-field cron expression
  webhookPath?: string;
  chatId?: string;             // Telegram chat ID
}
```

### AgentConfig
```typescript
interface AgentConfig {
  engine?: AgentEngine;        // Default: "claude"
  systemPrompt?: string;
  model?: string;              // Claude model (e.g., "sonnet", "opus")
  ollamaModel?: string;
  providerId?: string;         // OpenAI-compatible provider ID
  openaiModel?: string;
  thinking?: boolean;          // Enable extended thinking
  maxTurns?: number;           // Max tool-use turns (default 25)
  maxBudgetUsd?: number;       // Cost cap (default $1.00)
  debugResponse?: string;      // Static response for debug engine
  tools?: ToolConfig[];        // Attached tool/MCP/KB connections
}
```

### ResolvedAgentConfig
```typescript
interface ResolvedAgentConfig extends AgentConfig {
  allowedTools: string[];      // Builtin tool IDs
  mcpServers: string[];        // Legacy MCP server IDs
  mcpTools?: ToolConfig[];     // Registry-sourced MCP tools
  knowledgeBases: string[];    // KB IDs
}
```

### ToolConfig
```typescript
interface ToolConfig {
  toolType: "builtin" | "mcp" | "knowledge";
  toolId: string;              // Node ID or registry ID
  toolName?: string;
  mcpLaunchConfig?: McpServerLaunchConfig;
}
```

### ConditionConfig
```typescript
interface ConditionConfig {
  expression: string;          // JavaScript expression evaluated against input
}
```

### CodeConfig
```typescript
interface CodeConfig {
  runtime: CodeRuntime;
  code: string;
}
```

### PromptConfig
```typescript
interface PromptConfig {
  description?: string;        // What this Channel Loop node does
}
```

### OutputConfig
```typescript
interface OutputConfig {
  type: OutputType;
  chatId?: string;             // For Telegram output
  config: Record<string, unknown>;
}
```

### DiscussionConfig
```typescript
interface DiscussionConfig {
  prompt: string;              // Template: {{agentName}}, {{input}}, {{transcript}}, {{round}}
  maxRounds: number;
  moderator?: DiscussionModeratorConfig;
}

interface DiscussionModeratorConfig {
  type: "code" | "agent";
  node: {
    label: string;
    type: string;
    config: CodeConfig | AgentConfig;
  };
}
```

### McpServerLaunchConfig
```typescript
interface McpServerLaunchConfig {
  registryName?: string;
  package?: {
    registryType: "npm" | "pypi" | "oci";
    identifier: string;
    version?: string;
    runtimeHint?: string;
    environmentVariables?: Array<{ name: string; description?: string }>;
    packageArguments?: Array<{ name: string; description?: string }>;
  };
  remote?: {
    type: "streamable-http" | "sse";
    url: string;
  };
  envValues?: Record<string, string>;
  argValues?: Record<string, string>;
}
```

## Run & Task Types

```typescript
interface Run {
  id: number;
  workflowId: number;
  status: RunStatus;
  triggerType?: string;
  triggerPayload?: unknown;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
}

interface AgentTask {
  id: number;
  runId: number;
  nodeId: string;
  status: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  tokensUsed?: number;
  costUsd?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

interface RunEvent {
  id: number;
  runId: number;
  nodeId?: string;
  type: string;
  data?: unknown;
  createdAt: string;
}
```

## API Request/Response Types

```typescript
interface CreateWorkflowRequest {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  enabled?: boolean;
}

interface RunDetailResponse {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
  checkpoint?: { completedNodes: string[]; createdAt: string } | null;
}

interface DashboardResponse {
  activeRuns: number;
  totalWorkflows: number;
  recentRuns: Run[];
  agentTasks: AgentTask[];
}
```

## Constants

```typescript
MAX_WORKFLOW_ITERATIONS = 100
DEFAULT_AGENT_MAX_TURNS = 25
DEFAULT_AGENT_MAX_BUDGET_USD = 1.0
DEFAULT_AGENT_POOL_SIZE = 3
DEFAULT_CODE_TIMEOUT_MS = 60_000
DEFAULT_AGENT_TIMEOUT_MS = 300_000
CRON_CHECK_INTERVAL_MS = 15_000
CRON_SYNC_INTERVAL_MS = 60_000
```

## Error Codes

| Category | Codes |
|----------|-------|
| General | INTERNAL, NOT_FOUND, VALIDATION, UNAUTHORIZED |
| Workflow | WORKFLOW_NOT_FOUND, WORKFLOW_DISABLED, WORKFLOW_CYCLE_DETECTED, WORKFLOW_MAX_ITERATIONS, WORKFLOW_NO_ENTRY |
| Agent | AGENT_FAILED, AGENT_TIMEOUT, AGENT_NO_MODEL, AGENT_POOL_FULL |
| Code | CODE_EXECUTION_FAILED, CODE_TIMEOUT, CODE_INVALID_RUNTIME |
| Run | RUN_NOT_FOUND, RUN_ALREADY_CANCELLED |
| Trigger | TRIGGER_NOT_FOUND, TELEGRAM_NO_TOKEN, TELEGRAM_SEND_FAILED |
| MCP | MCP_CONNECTION_FAILED, MCP_TOOL_FAILED |
| Ollama | OLLAMA_NOT_RUNNING, OLLAMA_MODEL_NOT_FOUND |

All errors use `AppError` class with `code`, `statusCode`, and optional `details`.
