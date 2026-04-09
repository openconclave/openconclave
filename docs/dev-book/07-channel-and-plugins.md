# Channel & Plugin System

OpenConclave integrates with Claude Code through two MCP server interfaces: the **channel plugin** (real-time events + workflow tools) and the **dev plugin** (workflow CRUD + observability).

## Channel Plugin (`openconclave-channel`)

**Location:** Main repo: `packages/server/src/channel/openconclave-channel.ts`. Production version: `openconclave-marketplace/openconclave-channel/server.ts`.

**Purpose:** Bridges OpenConclave events to Claude Code via the MCP channel protocol. Claude Code receives workflow outputs, prompt questions, and improvement requests as channel notifications.

### Core Tools

| Tool | Description |
|------|-------------|
| `oc_list_workflows` | List all workflows (id, name, enabled) |
| `oc_trigger_workflow` | Trigger a run with payload + cwd |
| `oc_get_run` | Get run details with tasks |
| `oc_list_runs` | List recent runs |
| `oc_respond` | Respond to a pending prompt question |
| `oc_pending_prompts` | List prompts waiting for response |

### Dynamic Workflow Tools

Each enabled workflow with a `toolName` in its definition is registered as its own MCP tool. Synced at startup via `syncWorkflowTools()`. Tool signature: `toolName(input?, cwd)`.

### Channel Events (WebSocket → MCP Notification)

The plugin connects to OpenConclave's WebSocket, subscribes to the "dashboard" topic, and forwards relevant events as `notifications/claude/channel`:

| Event | Trigger | Content |
|-------|---------|---------|
| `channel:output` | Output node (type: "claude-code") | Workflow output text. Large outputs saved to `.openconclave/outputs/` and truncated inline at 2000 chars. |
| `prompt:question` | Prompt node waiting for response | Question text + metadata (runId, nodeId). Claude Code must call `oc_respond`. |
| `channel:improve-prompt` | User clicks "Improve" on agent system prompt | Current prompt + instructions to call `update_node` |
| `channel:improve-description` | User clicks "Improve" on workflow instructions | Current description + instructions to call `update_workflow` |
| `channel:improve-code` | User clicks "Improve" on code node | Current code + runtime + instructions to call `update_node` |

### Event Metadata

All channel notifications include metadata: `event_type`, `run_id`, `node_id`, `task_id`, `status`, `success`, `duration_ms`, `workflow_name`, `node_label`, `sender_node`, `sender_type`.

## Dev Plugin (`openconclave-dev`)

**Location:** `packages/server/src/mcp/server.ts`. Marketplace: `openconclave-marketplace/openconclave-dev/`.

**Purpose:** Full workflow management for Claude Code — create, read, update, delete workflows; observe runs; manage scheduling.

### Tools

| Tool | Description |
|------|-------------|
| `list_workflows` | List all workflows |
| `get_workflow` | Get full workflow definition |
| `create_workflow` | Create new workflow |
| `update_workflow` | Update metadata or full definition |
| `delete_workflow` | Delete workflow |
| `add_node` | Add node to existing workflow |
| `update_node` | Update node config |
| `get_node` | Get node details |
| `get_run` | Get run details |
| `list_runs` | List runs (filterable by status) |
| `cancel_run` | Cancel a running workflow |
| `get_schedule` | List cron-scheduled workflows |
| `get_dashboard` | Dashboard stats |
| `get_agent_status` | Running agent info |
| `pause_workflow` | Disable workflow |
| `resume_workflow` | Enable workflow |

## Run Plugin (`openconclave-run`)

**Location:** `openconclave-marketplace/openconclave-run/`.

**Purpose:** Exposes each enabled workflow as a directly callable MCP tool. The tool name comes from the workflow's `toolName` field, and the description from its `description` field.

Tools are registered at module load time by fetching `/api/workflows`. The MCP process must be fully restarted to pick up new workflow definitions or description changes.

## Plugin Distribution (Marketplace)

**Location:** `openconclave-marketplace/` — separate repo.

Structure:
```
openconclave-marketplace/
  .claude-plugin/
    marketplace.json         # Marketplace metadata + version
  openconclave-channel/
    .claude-plugin/plugin.json
    package.json
    server.ts
  openconclave-dev/
    .claude-plugin/plugin.json
    package.json
    server.ts
  openconclave-run/
    .claude-plugin/plugin.json
    package.json
    mcp-proxy.ts
```

**Version bumping:** When updating a plugin, bump versions in BOTH `package.json` AND `.claude-plugin/plugin.json`. The `/plugin` update command checks `package.json` version to detect changes.

## "Improve" Button Flow

The client-side "Improve" buttons (on agent prompt, workflow instructions, and code nodes) follow this pattern:

1. **Client** clicks Improve → POST to `/api/channel/improve-{type}` with current content
2. **Server** broadcasts event to "dashboard" WebSocket topic
3. **Channel plugin** receives WebSocket event → formats instructions → sends MCP channel notification to Claude Code
4. **Claude Code** reads the notification, improves the content, calls `update_node` or `update_workflow` via the dev plugin
5. **Client** polls the API every 3 seconds for up to 60 seconds, checking if the content changed
6. When change detected → update local state, show success toast

## WebSocket Broadcasting

`ws/broadcast.ts` provides:
- `broadcastRunEvent(event: RunEvent)` → publishes to `run:{runId}` and `dashboard` topics
- `broadcastToTopic(topic, data)` → publish to any named topic

Clients subscribe by sending `{ type: "subscribe", topics: ["dashboard", "run:123"] }`.
