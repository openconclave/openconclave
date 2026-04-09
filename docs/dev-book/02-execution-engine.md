# Execution Engine

The engine lives in `packages/server/src/engine/` and is responsible for running workflow DAGs.

## Core Components

### WorkflowExecutor (`executor.ts`)

High-level orchestrator with three entry points:

- **`execute(workflow, payload?, triggerNodeId?)`** — Start a fresh run. Inserts a `runs` row (status: "running"), calls `executeGraph()` asynchronously (fire-and-forget), returns the `runId`.
- **`executeInRun(runId, workflow, payload?, triggerNodeId?)`** — Continue an existing run (used for chat continuation). Runs `executeGraph()` without creating a new run row.
- **`resume(runId, workflow)`** — Resume a failed/interrupted run from the latest checkpoint. Uses an atomic conditional UPDATE to claim the run (prevents double-resume).

All events flow through `emit(event)` which persists to `run_events` and calls the `onEvent` callback (used for WebSocket broadcast).

### Graph Walker (`graph-walker.ts`)

The core execution loop. This is the largest non-test file in the engine (~20KB).

**Execution flow:**
1. Normalize workflow (remap legacy node type names)
2. Topological sort via Kahn's algorithm → execution layers
3. If resuming: restore nodeOutputs, completedNodes, agentSessions from checkpoint
4. Walk layers in order. For each node:
   - Skip if already completed (resume) or if it's a discussion participant-only node
   - Call `executeNode()` to dispatch to the type-specific handler
   - Create a checkpoint after successful completion
   - Resolve next entries (route targets, condition branches)
5. Handle loop-back targets for iterative workflows
6. On completion or failure, update run status in DB

**Key data structures (all per-run, in-memory):**
- `nodeOutputs: Map<string, unknown>` — output from each completed node
- `agentSessions: Map<string, string>` — nodeId → sessionId for multi-turn agents
- `checkpointOutputs` — raw executeNode outputs (never mutated by routing resolution)

**Persistent sessions** — For chat workflows, agent session IDs survive across separate run continuations via `persistentSessions` (module-level Map with FIFO eviction at 256 entries).

**Active workspaces** — `activeWorkspaces: Map<number, Workspace>` tracks each run's workspace, allowing code nodes to update the CWD mid-run (e.g., after creating a git worktree).

### Node Executor (`node-executor.ts`)

Routes `executeNode()` calls to the correct handler based on `node.data.type`:

| Type | Handler | File |
|------|---------|------|
| trigger | `executeTrigger()` | `nodes/trigger.ts` |
| agent | `executeAgentNode()` | `nodes/agent.ts` |
| condition | `executeCondition()` | `nodes/condition.ts` |
| code | `executeCode()` | `nodes/code.ts` |
| merge | `executeMerge()` | `nodes/merge.ts` |
| prompt | `executePrompt()` | `nodes/prompt.ts` |
| file | `executeFile()` | `nodes/file.ts` |
| output | `executeOutput()` | `nodes/output.ts` |
| discussion | `executeDiscussion()` | `nodes/discussion.ts` |

**Input resolution:**
- Single incoming edge → pass upstream node's output directly
- Multiple incoming edges → collect as array
- Discussion nodes → filter to data edges only (exclude "participants" handle)

### Checkpoint System

After each node completes, a `checkpoints` row is written:

```
{ runId, nodeId, nodeOutputs (JSON), completedNodes (JSON), agentSessions (JSON) }
```

On resume, the latest checkpoint provides:
- Which nodes already completed (skip them)
- Their outputs (available to downstream nodes)
- Agent session IDs (restore multi-turn conversations)

A `resumeSkipNodes` set prevents re-executing checkpoint nodes on subsequent resumes.

**Design decisions (intentional, not bugs):**
- **Per-node checkpointing is required.** Each node writes a checkpoint immediately after completion. This enables resume-from-failure at node granularity — if a run crashes mid-execution, all previously completed nodes are preserved. The `checkpointOutputs` map stores raw `executeNode` outputs separately from `nodeOutputs` (which gets mutated by routing resolution), ensuring checkpoint data is always safe. Do NOT consolidate to a single end-of-run checkpoint.
- **Parallel batch execution via `Promise.all` is intentional.** Independent nodes in the same topological layer execute concurrently. This is a core feature — multi-agent workflows (e.g., 3 parallel code reviewers) depend on it. If one node fails, the others complete and their results are checkpointed. The failure is caught and the run can be resumed. Do NOT replace with sequential execution.

### Graph Utilities (`graph.ts`)

- `topologicalSort(nodes, edges)` → `ExecutionLayer[]` — Kahn's algorithm producing parallel-safe layers
- `getIncomingEdges(nodeId, edges)` → edges targeting this node
- `getOutgoingEdges(nodeId, edges)` → edges leaving this node

### Scheduler (`scheduler.ts`)

`CronScheduler` class that polls the DB every minute for enabled workflows with cron triggers:

- Simple 5-field cron parser (minute, hour, day, month, weekday)
- Supports: `*`, `*/N` (step), comma-separated values
- Searches 48 hours ahead for next match
- Calls `WorkflowExecutor.execute()` when a job is due

### Prompt Registry (`prompt-registry.ts`)

Implements human/Claude-in-the-loop blocking:

- `registerPrompt(runId, nodeId, question, input)` — Returns a Promise that blocks until someone calls `respondToPrompt()`
- `respondToPrompt(runId, nodeId, response)` — Resolves the blocking Promise
- `getPendingPrompts()` / `getPendingPromptForRun(runId)` — Query waiting prompts
- `clearPromptsForRun(runId)` — Cancel all prompts (used on run cancellation)

### Workspace (`workspace.ts`)

Single source of truth for working directory and MCP server configuration:

- `cwd` — Absolute path, normalized. Defaults to `SERVER_CWD` (process.cwd).
- `setCwd(newCwd)` — Update mid-run (e.g., code node creates a worktree)
- `resolve(path)` — Relative → absolute path resolution against cwd
- `addAllowedDir(dir)` — Grant filesystem MCP server access to additional directories
- `getMcpToolConfigs(mcpTools, legacyIds)` — Resolve ToolConfig[] to `Record<serverId, McpResolvedConfig>` supporting stdio, streamable-http, and sse transports
- `static fromTrigger(payload?, config?)` — Extract `_callerCwd` from trigger payload or `workingDirectory` from trigger config

## Node Executors

### Trigger (`nodes/trigger.ts`)
Validates trigger payload, extracts working directory, returns payload or user input.

### Agent (`nodes/agent.ts`)
Resolves connected tools (builtin, MCP, knowledge) from agent config. Merges system prompt with workflow-level context. Dispatches to the appropriate engine runtime. Handles routing targets (condition-like output selection) and session restoration for multi-turn chat.

### Code (`nodes/code.ts`)
Spawns a subprocess for the configured runtime:
- **python** — `python3` or `python`
- **node** — `bun run`
- **bash** — Resolves Git Bash on Windows

Environment variables: `INPUT`, `OC_WORKFLOW_ID`, `OC_RUN_ID`, `OC_NODE_ID`. Input piped via stdin. Output read from stdout, parsed as JSON (falls back to plain string).

### Condition (`nodes/condition.ts`)
Evaluates a JavaScript expression against the input. Returns the matched route target name or undefined. Uses a sandboxed expression evaluator from `lib/expression.ts`.

### Merge (`nodes/merge.ts`)
Waits for all connected inputs to arrive. Combines them into a single object using each source node's label as the key: `{ "Node A": outputA, "Node B": outputB }`.

### Prompt (`nodes/prompt.ts`)
Registers a blocking prompt via the prompt registry. Emits a `prompt:question` event (which reaches Claude Code via channel). Blocks until a response arrives via `POST /api/prompts/respond` or `oc_respond` MCP tool.

### Output (`nodes/output.ts`)
Routes output to the configured destination:
- **log** — Emit as run event
- **claude-code** — Broadcast `channel:output` to dashboard WebSocket topic
- **telegram** — Send via Telegram Bot API

### File (`nodes/file.ts`)
Reads or writes files based on config. Resolves paths against workspace CWD.

### Discussion (`nodes/discussion.ts`)
Orchestrates multi-agent round-table conversations. Participants are agent nodes connected via the "participants" edge handle. Supports code-based (deterministic script) or agent-based (LLM) moderation. Accumulates transcript across rounds. Moderator can: advance round-robin, pick a specific agent, or end the discussion.

## Event Types

| Event | Emitted By |
|-------|-----------|
| `run:started` | executor |
| `run:completed` | graph-walker |
| `node:started` | node-executor |
| `node:completed` | node-executor |
| `node:failed` | node-executor |
| `node:skipped` | graph-walker |
| `agent:started` | agent-executor |
| `agent:thinking` | agent runtime |
| `agent:output` | agent runtime |
| `agent:completed` | agent-executor |
| `discussion:started` | discussion executor |
| `discussion:speech` | discussion executor |
| `discussion:moderator` | discussion executor |
| `discussion:completed` | discussion executor |
| `prompt:question` | prompt executor |
| `channel:output` | output executor |
| `chat:userMessage` | REST API (persisted directly) |
| `chat:response` | graph-walker (chat continuation) |
