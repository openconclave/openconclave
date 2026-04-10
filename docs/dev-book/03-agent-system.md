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
- **External MCP servers** — Configured via `config.mcpServers` and exposed to the SDK as stdio MCP servers. The SDK spawns one subprocess per server.
- **In-process workflow tools** — Tools that need the executor's own state (routing, knowledge, ask_user) are built per-invocation using `createSdkMcpServer()` and `tool()` from the Agent SDK itself, then passed to `query()` via `mcpServers["openconclave-workflow"]`. No subprocess is spawned. The tools execute in the same Node/Bun event loop as the rest of the server, which means:
  - Tool handlers can call the server's underlying modules directly (`searchMultipleKBs`, `registerPrompt`, `broadcastRunEvent`, `ingestText`, direct `db.select`) without going through HTTP loopback.
  - There is no re-entrancy risk and no latency cliff from serializing through Hono routing.
  - Errors thrown inside a tool handler are caught by a `try/catch` wrapper that returns an MCP error content block, so thrown exceptions never escape into the agent turn.
- **Bunfs CLI extraction** — On Windows, the Claude CLI embedded by the SDK lives inside the compiled Bun binary at `B:/~BUN/...`. `runtime.ts` re-extracts it to a stable temp path via `resolveCliPath()` before calling `query({ pathToClaudeCodeExecutable })`, so the SDK can actually spawn it. See `d71a547` for the history.
- **Thinking blocks** — Supported when `config.thinking` is true.
- **Cost tracking** — Computed from token usage (input/output/cache tokens) as reported in the `result` message.

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

Single-turn LLM calls with dynamic tool definitions. Used by discussion node moderators and the `/api/agents/invoke` endpoint.

`invokeWithTools({ engine, config, prompt, tools, runId, nodeId, emit })` → `{ output, tool_call? }`

For Claude: builds an in-process SDK MCP server from the provided `ToolDef[]` using `createSdkMcpServer()` and `tool()`, converts each `ToolDef.input_schema` (JSON schema) to a zod shape via a local `jsonSchemaToZod()` helper, and passes the server to `query()` via `mcpServers["game-tools"]`. A closure variable captures the tool name and input when the agent calls the tool, and is returned to the caller as `tool_call`. No subprocess, no state file, single-turn, no session.

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

## In-process workflow tools (inside `runtime.ts`)

The Claude runtime builds a per-invocation SDK MCP server by calling `createSdkMcpServer({ name: "openconclave-workflow", tools: [...] })` and registers tool handlers via `tool(name, description, zodShape, handler)`. The server is passed into `query({ mcpServers: { "openconclave-workflow": sdkServer } })` and runs in the same process, not as a subprocess.

The tools added depend on the agent's graph context:

- **`openconclave_next`** — added when `routeTargets.length >= 1`. The handler writes the chosen route to a closure variable `routingState` that the executor reads after `query()` resolves.
- **`ask_user`** — added when `promptConfig` is set (agent has bidirectional prompt connections). The handler calls `broadcastRunEvent({ type: "prompt:question", ... })` to notify the channel plugin, then `await registerPrompt(runId, nodeId, question, null)` which blocks until a response arrives via `POST /api/prompts/respond` or the `oc_respond` MCP tool. Both are direct function calls into the server's own modules — no HTTP loopback.
- **`knowledge_search`** — added when the agent has knowledge bases attached. The handler calls `searchMultipleKBs(targetIds, query, topK)` from `knowledge/search.ts` directly.
- **`knowledge_fetch`** — added with knowledge tools. The handler does `db.select` queries against the `documents` and `chunks` tables directly.
- **`knowledge_add`** — added with knowledge tools. The handler calls `ingestText(kbId, filename, content)` from `knowledge/ingest.ts` directly.

Each handler is wrapped in `try/catch` that returns an MCP error content block on failure, so thrown exceptions never escape into the agent turn.

**The HTTP routes `/api/prompts/ask`, `/api/knowledge/:id/search`, `/api/knowledge/:id/documents/:docId/chunks`, `/api/knowledge/:id/ingest` are still live and untouched** — external callers (Claude Code plugin, curl, web UI) use them as before. Only the in-process path bypasses them.

### Why not loopback HTTP?

Before `a64a6d2` (April 2026), these tool handlers used `fetch("http://localhost:4000/api/...")` to call the server's own HTTP routes. That introduced several problems in compiled Bun binaries:

- **Re-entrancy crashes.** A tool handler inside an agent turn would make a loopback HTTP call, hit a Hono route that threw an `AppError`, and Bun's error reporter in the compiled binary would print the construction stack while the error was being handled by the middleware — wedging the server hard enough to need a manual restart. Observed in run 404 with a hallucinated `document_id: 1`.
- **Latency cliffs.** An agent calling `knowledge_search` with `topK: 20` would block the event loop for the duration of the embedding call plus vector search plus JSON serialization — seconds to minutes. Every browser request during that window queued behind it. The UI appeared frozen. Observed in runs 407 and 411.
- **Opaque errors.** Tool handlers received a JSON response body with no stack trace, so debugging a knowledge query failure meant reading opaque "Error fetching document" messages instead of real stack frames.

All three classes are eliminated by calling the underlying modules directly. **When adding a new tool that needs data the server already has, always import the function directly; never write `fetch("http://localhost:4000/...")` inside an in-process tool handler.**
