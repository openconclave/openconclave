# Database Schema

OpenConclave uses **SQLite** with **Drizzle ORM**. Schema defined in `packages/server/src/db/schema.ts`, client in `db/client.ts`.

## Tables

### workflows

Stores workflow definitions (the DAG structure).

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| name | text | Workflow display name |
| description | text | Instructions for Claude (workflow-level context) |
| definition | json | Full WorkflowDefinition: { nodes[], edges[], toolName? } |
| enabled | boolean | Whether the workflow can be triggered |
| createdAt | text | ISO timestamp |
| updatedAt | text | ISO timestamp |

### runs

Each execution of a workflow.

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| workflowId | integer (FK → workflows) | Which workflow was run |
| status | text | "running", "success", "failure", "interrupted", "cancelled" |
| triggerType | text | "manual", "cron", "webhook", "telegram", "chat" |
| triggerPayload | json | Payload passed to the trigger node |
| startedAt | text | ISO timestamp |
| completedAt | text | ISO timestamp |
| error | text | Error message if failed |
| createdAt | text | ISO timestamp |

### agentTasks

Individual LLM calls made during a run.

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| runId | integer (FK → runs) | Parent run |
| nodeId | text | Which node triggered this call |
| status | text | "queued", "running", "completed", "failed" |
| prompt | text | User/system prompt sent to LLM |
| systemPrompt | text | System prompt |
| model | text | Model identifier (default "sonnet") |
| input | json | Raw input data |
| output | json | LLM response |
| error | text | Error if failed |
| tokensUsed | integer | Total tokens consumed |
| costUsd | real | Estimated cost in USD |
| startedAt | text | ISO timestamp |
| completedAt | text | ISO timestamp |
| createdAt | text | ISO timestamp |

### runEvents

Append-only event log for each run. Powers the run detail view and WebSocket broadcasting.

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| runId | integer (FK → runs) | Parent run |
| nodeId | text (nullable) | Which node emitted the event |
| type | text | Event type (see Execution Engine doc) |
| data | json | Event-specific payload |
| createdAt | text | ISO timestamp |

### checkpoints

Execution snapshots for resume-from-failure.

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| runId | integer (FK → runs) | Parent run |
| nodeId | text | Node that just completed |
| nodeOutputs | json | Record<nodeId, output> — all outputs so far |
| completedNodes | json | string[] — IDs of completed nodes |
| agentSessions | json | Record<nodeId, sessionId> — for multi-turn |
| createdAt | text | ISO timestamp |

### settings

Key-value store for global configuration.

| Column | Type | Description |
|--------|------|-------------|
| key | text (PK) | Free-form string key (no enforced prefix) |
| value | text | JSON-encoded value |
| updatedAt | text | ISO timestamp |

Used for: LLM provider configs (API keys, base URLs), Telegram bot token, Ollama URL, etc.

**Key conventions (not enforced, just patterns in use):**
- `provider:{id}` — LLM provider configs (e.g., `provider:openai`)
- `ollama_url` — Ollama API endpoint
- `telegram_bot_token` — Telegram integration
- `onboarding_completed` — First-run flag (string `"true"`)

The `PUT /api/settings` endpoint accepts `{ key: value, ... }` pairs and writes them directly — there is no `setting:` prefix requirement. The client reads them back as a flat `Record<string, string>` from `GET /api/settings`.

### knowledgeBases

RAG knowledge base definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| name | text | Display name |
| description | text | What this KB contains |
| embeddingModel | text | Ollama model for embeddings |
| chunkSize | integer | Characters per chunk |
| chunkOverlap | integer | Overlap between chunks |
| createdAt | text | ISO timestamp |
| updatedAt | text | ISO timestamp |

### documents

Source documents ingested into a knowledge base.

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| knowledgeBaseId | integer (FK) | Parent KB |
| filename | text | Original filename |
| sourcePath | text | Where the file came from |
| content | text | Raw content |
| contentHash | text | For dedup/change detection |
| createdAt | text | ISO timestamp |

### chunks

Chunked and embedded document fragments for vector search.

| Column | Type | Description |
|--------|------|-------------|
| id | integer (PK) | Auto-increment |
| documentId | integer (FK → documents) | Parent document |
| knowledgeBaseId | integer (FK) | Parent KB (denormalized for query perf) |
| content | text | Chunk text |
| metadata | json | Source info, position, etc. |
| embedding | text | JSON-encoded float[] vector |
| chunkIndex | integer | Position within document |
| createdAt | text | ISO timestamp |

### mcpServers

Registered MCP server configurations.

| Column | Type | Description |
|--------|------|-------------|
| name | text (PK) | Server identifier |
| type | text | "package" or "remote" |
| config | json | McpServerLaunchConfig |
| enabled | boolean | Whether available for use |
| createdAt | text | ISO timestamp |

## Relationships

```
workflows 1──N runs 1──N agentTasks
                  1──N runEvents
                  1──N checkpoints

knowledgeBases 1──N documents 1──N chunks
```

## Cascading Deletes

Deleting a workflow cascades to: runs → (agentTasks, runEvents, checkpoints).
Deleting a knowledge base cascades to: documents → chunks.
