# Agent System

The agent layer lives in `packages/server/src/agent/` and handles all LLM interactions across multiple engines.

## Agent Execution Flow

```
Node Executor → executeAgent() (agent-executor.ts)
                    ↓
              Resolve tools (AgentBase)
                    ↓
              Dispatch to engine runtime
              ┌─────────┬──────────┬──────────┐
              Claude    Ollama     OpenAI     Debug
              (SDK)     (HTTP)     (compat)   (static)
```

## Agent Executor (`agent-executor.ts`)

Entry point: `executeAgent(runId, nodeId, config, input, emit, routeTargets?, sessionId?, workspace?, edges?, nodeMap?)`

Returns `{ output: string, thinking?: ThinkingBlock[], sessionId?: string }`.

**Tool resolution** — Before dispatching to an engine, resolves tools from the agent's config:
- `config.allowedTools` → builtin tool IDs (Bash, Read, Write, WebFetch)
- `config.mcpServers` / `config.mcpTools` → external MCP servers
- `config.knowledgeBases` → knowledge base search/fetch/add tools
- Route targets → `route_workflow` tool (lets agent pick a branch)
- Bidirectional prompt connections → `ask_user` tool

## AgentBase (`base.ts`)

Unified tool resolution for all engines. Created per-agent-invocation.

**Constructor flow:**
1. `resolveBuiltinTools()` — Maps config.allowedTools to builtin executors
2. `resolveKnowledgeTools()` — Adds search_knowledge, knowledge_fetch, knowledge_add when KBs connected
3. `connectMcpServers()` — Launches MCP servers, discovers their tools via MCP protocol

**Tool name mapping** (TOOL_NAME_MAP):
- `Bash` → `bash`
- `Read` → `read_file`
- `Write` → `write_file`
- `WebFetch` → `web_fetch`

**Output formats:**
- `toChatTools()` — OpenAI Chat Completions format (nested under `function`)
- `toResponsesTools()` — OpenAI Responses API format (top-level)
- `getToolIds()` — Plain name list for Ollama filtering

## Engine Runtimes

### Claude (`runtime.ts`)

Uses the Anthropic Agent SDK (`@anthropic-ai/claude-agent-sdk`).

- **Session management** — Passes `sessionId` for multi-turn conversations. The SDK handles message history.
- **MCP servers** — Builtin tools and external MCP servers are exposed as stdio MCP servers to the SDK.
- **Workflow MCP server** — A special per-invocation MCP server (`workflow-mcp-server.ts`) that provides:
  - `route_workflow` tool — Select a downstream branch
  - Knowledge tools — When KBs are connected
  - `ask_user` tool — When bidirectional prompt connections exist
- **Thinking blocks** — Supported when `config.thinking` is true
- **Cost tracking** — Computed from token usage (input/output/cache tokens)

### Ollama (`ollama.ts`)

Local HTTP API at `OLLAMA_URL` (default: `http://localhost:11434`).

- **Tool calling** — Uses Ollama's native function_calling format
- **Session persistence** — Conversation history stored as JSONL files on disk
- **Thinking blocks** — Extracted from `<think>...</think>` tags in output
- **Tool name mapping** — Ollama uses lowercase names (bash, read_file, etc.)
- **Status check** — `checkOllama()` returns { installed, running, models[] }

Helper modules: `ollama-types.ts`, `ollama-routing.ts`, `ollama-tools.ts`

### OpenAI (`openai.ts`)

Supports any OpenAI-compatible provider (configured in settings).

- **API type detection** — "responses" (extended thinking) or "chat" (standard)
- **Two execution paths:**
  - `openai-responses.ts` — Responses API with extended thinking support
  - `openai-chat.ts` — Chat Completions API (most providers)
- **Provider resolution** — Looks up base URL, API key, and model from `settings` table by `config.providerId`
- **Model listing** — `listOpenAIModels(provider)` queries the provider's `/v1/models` endpoint

Helper modules: `openai-types.ts`, `openai-debug.ts`, `openai-routing-tools.ts`

### Debug

Returns `config.debugResponse` as static output. No LLM call, no tools.

## MCP Bridge (`mcp-bridge.ts`)

Connects agents to external MCP servers at runtime.

**Supported transports:**
- `stdio` — Spawn child process (command + args + env)
- `streamable-http` — StreamableHTTPClientTransport
- `sse` — Server-Sent Events transport

**Tool naming:** `{sanitizedServerId}__{toolName}` — Server IDs are sanitized to match `^[a-zA-Z0-9_-]+$` (OpenAI requirement).

**Schema sanitization:** Removes tuple validation and other constructs incompatible with OpenAI's function calling.

**Lifecycle:** `connectResolved()` → use tools → `disconnect()` (cleans up all transports).

## LLM Call Dispatcher (`llm-call.ts`)

Single-turn LLM calls with dynamic tool definitions. Used by moderators and the `/api/agents/invoke` endpoint.

`invokeWithTools({ engine, config, prompt, tools, runId, nodeId, emit })` → `{ output, tool_call? }`

For Claude: spawns a `dynamic-tools-mcp-server.ts` subprocess that serves the provided tool definitions as an MCP server, then uses the Agent SDK's `query()` (single-turn, no session).

## Builtin Tools (`builtin-tools.ts`)

`createBuiltinTools(workspace?)` returns a Record of tool executors:

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands (respects workspace.cwd) |
| `read_file` | Read file contents |
| `write_file` | Write/overwrite files |
| `web_fetch` | Fetch HTTP content |
| `search_knowledge` | Query knowledge bases |
| `knowledge_fetch` | Retrieve specific chunks |
| `knowledge_add` | Ingest new documents |
| `route_workflow` | Route to downstream workflow targets |
| `ask_user` | Send question to connected prompt node |

## Workflow MCP Server (`workflow-mcp-server.ts`)

A per-invocation MCP server exposed to the Claude SDK. Provides workflow-aware tools that the generic builtin system doesn't cover:

- Routing tools (when agent has outgoing condition edges)
- Knowledge tools (when agent has connected knowledge bases)
- Ask-user tools (when agent has bidirectional prompt connections)

Runs as a stdio subprocess, communicates via stdin/stdout with the Agent SDK.
