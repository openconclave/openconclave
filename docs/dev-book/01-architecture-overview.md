# OpenConclave Architecture Overview

OpenConclave is a visual workflow orchestration platform for AI agents. Users design workflows as directed acyclic graphs (DAGs) in a browser-based editor, then execute them with multi-engine LLM support.

## Monorepo Structure

```
packages/
  shared/   — TypeScript types, Zod schemas, constants, error codes (no build step)
  server/   — Bun runtime, Hono HTTP API, execution engine, agent runtimes
  client/   — React + Vite SPA, workflow editor (React Flow), Zustand state
```

Runtime: **Bun** (server), **Vite** (client dev server proxies `/api` and `/ws` to port 4000).

## High-Level Data Flow

```
Browser Editor → REST API → SQLite (Drizzle ORM) → WorkflowExecutor
                                                        ↓
                                                  Graph Walker
                                                        ↓
                                            Node Executors (per type)
                                                        ↓
                                            Agent Runtimes (Claude / Ollama / OpenAI)
                                                        ↓
                                            Events → WebSocket → Dashboard
```

1. **Editor** — Users drag nodes onto a canvas, wire edges, configure each node in the inspector panel.
2. **Save** — `PUT /api/workflows/:id` persists the full `WorkflowDefinition` (nodes + edges as JSON) to the `workflows` table.
3. **Trigger** — Manual, cron, webhook, chat, Telegram, or MCP channel. Creates a `runs` row with status `running`.
4. **Execution** — `WorkflowExecutor` calls `executeGraph()`, which topologically sorts the DAG, walks layers, dispatches each node to its type-specific executor.
5. **Checkpoints** — After every node completes, a checkpoint row is written (nodeOutputs, completedNodes, agentSessions). Enables resume-from-failure.
6. **Events** — Every significant action emits a `RunEvent`, persisted to `run_events` and broadcast over WebSocket to the dashboard.

## Key Directories (Server)

| Directory | Purpose |
|-----------|---------|
| `engine/` | Graph walker, node executors, scheduler, workspace, prompt registry |
| `agent/` | LLM runtimes (Claude SDK, Ollama HTTP, OpenAI-compatible), tool resolution, MCP bridge |
| `db/` | Drizzle ORM schema + SQLite client |
| `routes/` | Hono route handlers (workflows, runs, agents, knowledge, MCP registry) |
| `channel/` | MCP server for Claude Code channel integration |
| `mcp/` | MCP server for dev tooling (workflow CRUD, observability) |
| `knowledge/` | Knowledge base ingestion (chunking) and vector search |
| `triggers/` | Telegram bot long-polling trigger |
| `ws/` | WebSocket pub/sub broadcasting |
| `lib/` | Utilities — logger, errors, expression evaluator, template renderer |

## Key Directories (Client)

| Directory | Purpose |
|-----------|---------|
| `pages/` | Route-level components (dashboard, editor, runs, chat, settings, knowledge) |
| `components/editor/` | Canvas, nodes, inspector, palette, tool picker |
| `components/editor/inspector/` | Per-node-type field components (agent, trigger, code, etc.) |
| `components/editor/nodes/` | React Flow custom node components |
| `stores/` | Zustand store (`workflow-store.ts`) — nodes, edges, undo/redo, dirty tracking |
| `lib/` | API client, WebSocket client, utilities |

## Node Types

| Type | Purpose | Config Key Fields |
|------|---------|-------------------|
| **trigger** | Entry point — manual, cron, webhook, chat, telegram | type, workingDirectory, cron, prompt |
| **agent** | LLM call with tools | engine, model, systemPrompt, tools[], maxTurns |
| **condition** | Branching — evaluates JS expression | expression |
| **code** | Run Python / Node / Bash | runtime, code |
| **merge** | Wait for all inputs, combine by source label | (none) |
| **prompt** | Channel Loop — pause and ask Claude Code | description |
| **output** | Send results (log, Claude Code channel, Telegram) | type, chatId |
| **file** | Read/write files | path |
| **discussion** | Multi-agent round-table conversation | prompt, maxRounds, moderator |

## Agent Engines

| Engine | Runtime | Session Support | Tool Support |
|--------|---------|-----------------|-------------|
| **claude** | Anthropic Agent SDK (stdio MCP) | Yes (session IDs) | Builtin + MCP + Knowledge |
| **ollama** | Local HTTP API | Yes (JSONL files) | Builtin + MCP (via bridge) |
| **openai** | OpenAI-compatible providers | No | Builtin + MCP (via bridge) |
| **debug** | Static response | No | No |

## Persistence

- **SQLite** via Drizzle ORM — workflows, runs, agent_tasks, run_events, checkpoints, settings, knowledgeBases, documents, chunks, mcpServers.
- **In-memory** — persistent agent sessions (Map with FIFO eviction at 256 entries), active workspaces per run.
- **Filesystem** — Ollama session JSONL files, channel output files (`.openconclave/outputs/`).
