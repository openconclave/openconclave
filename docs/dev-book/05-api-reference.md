# API Reference

Server runs on port 4000 (Hono framework). Client dev server on port 5173 proxies `/api` and `/ws`.

## Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workflows` | List all workflows (id, name, description, enabled, definition) |
| GET | `/api/workflows/:id` | Get single workflow |
| GET | `/api/workflows/by-tool/:toolName` | Find workflow by exported MCP tool name |
| POST | `/api/workflows` | Create workflow (validated with Zod: createWorkflowSchema) |
| PUT | `/api/workflows/:id` | Update workflow (partial: name, description, definition, enabled) |
| DELETE | `/api/workflows/:id` | Delete workflow + cascade all runs/events/checkpoints |
| POST | `/api/workflows/:id/run` | Trigger a workflow run. Body: `{ payload? }`. Returns `{ runId }` |
| POST | `/api/workflows/:id/pause` | Disable workflow (set enabled=false) |
| POST | `/api/workflows/:id/resume` | Enable workflow (set enabled=true) |

## Runs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/runs` | List 50 most recent runs with computed cost/duration |
| GET | `/api/runs/:id` | Run detail: run, tasks[], events[], latest checkpoint |
| POST | `/api/runs/:id/cancel` | Cancel run + clear pending prompts |
| POST | `/api/runs/:id/resume` | Resume failed/interrupted run from checkpoint |
| POST | `/api/runs/:runId/message` | Continue chat workflow. Body: `{ message }` |
| POST | `/api/runs/:runId/cwd` | Update workspace CWD mid-run. Body: `{ cwd }` |

## Prompts (Human/AI in the Loop)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prompts/pending` | List all pending prompt questions |
| POST | `/api/prompts/respond` | Respond to prompt. Body: `{ runId, nodeId, response }` |

## Agents

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/invoke` | Single-turn agent call with tools. Body: `{ workflowId, runId, nodeId, prompt, systemPromptOverride?, tools? }` |
| GET | `/api/agents/status` | Running/queued agent task counts |
| GET | `/api/agents/tasks/:id/logs` | Agent task details |

## Knowledge Bases

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/knowledge` | List KBs with doc/chunk counts |
| POST | `/api/knowledge` | Create KB. Body: `{ name, description?, embeddingModel?, chunkSize?, chunkOverlap? }` |
| GET | `/api/knowledge/:id` | KB details |
| POST | `/api/knowledge/:id/ingest` | Ingest documents (text or file upload) |
| POST | `/api/knowledge/:id/search` | Search KB. Body: `{ query, topK? }` |
| DELETE | `/api/knowledge/:id` | Delete KB + cascade docs/chunks |

## Channel (Claude Code Integration)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/channel/improve-prompt` | Ask Claude Code to improve an agent's system prompt |
| POST | `/api/channel/improve-description` | Ask Claude Code to improve workflow instructions |
| POST | `/api/channel/improve-code` | Ask Claude Code to write/improve code node |
| GET | `/api/claude-code/status` | Check if Claude Code CLI is installed |

## Settings & Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update settings. Body: `{ key, value }` |
| GET | `/api/providers` | List configured LLM providers |
| POST | `/api/providers` | Add provider. Body: `{ id, name, baseUrl, apiKey }` |
| DELETE | `/api/providers/:id` | Remove provider |

## MCP Registry

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mcp/registry/search` | Search MCP server registry. Query: `?q=...` |
| GET | `/api/mcp/registry/servers/:name` | Get server details by registry name |

## Scheduler

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler` | Get schedule (cron jobs + next run times) |

## Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | Stats: activeRuns, totalWorkflows, recentRuns[], agentTasks[] |
| GET | `/api/health` | Health check |

## MCP Server (SSE Transport)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mcp/sse` | SSE stream for MCP clients |
| POST | `/mcp/messages` | MCP message endpoint |

## WebSocket

Connect to `ws://localhost:4000`. Subscribe to topics by sending:

```json
{ "type": "subscribe", "topics": ["dashboard", "run:123"] }
```

**Topics:**
- `dashboard` — All run lifecycle events, channel events
- `run:{runId}` — Events for a specific run

**Event format:**
```json
{ "type": "node:started", "runId": 123, "nodeId": "agent_1", "data": { ... } }
```

## Error Handling Conventions

All route handlers use `AppError` (from `@openconclave/shared`) for error responses. The central `errorHandler` middleware in `lib/errors.ts` catches thrown `AppError` instances and formats them as `{ error: { code, message } }` with the appropriate HTTP status.

**Rules:**
- **Always `throw AppError.*()` instead of manual `return c.json({ error: ... }, status)`.** Throwing ensures consistent JSON shape and goes through the error middleware.
- **Validate numeric ID params** after `Number(c.req.param(...))` — add `if (isNaN(id)) throw AppError.validation(...)` since `Number("abc")` silently returns `NaN`.
- **Do not use `.catch(() => ({}))` on `c.req.json()`** — this silently swallows malformed JSON. Instead:
  - If the body is **required**: let the parse error propagate, or wrap in try/catch and `throw AppError.validation("Invalid JSON")`.
  - If the body is **optional** (e.g., workflow trigger with optional payload): read raw text first, only parse if non-empty.
- **Required fields must be runtime-validated** — never trust `as Type` casts on user input. Check `typeof` and throw `AppError.validation(...)` if missing or wrong type.

**Available factories:**
```typescript
AppError.notFound(entity, id)      // 404
AppError.validation(message)       // 400
AppError.unauthorized(message)     // 401
// No built-in conflict() — use manual return c.json(..., 409) for CONFLICT cases
```
