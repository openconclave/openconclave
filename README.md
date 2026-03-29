# OpenConclave

Self-hosted AI agent orchestration platform with visual workflow automation. Built for deep integration with Claude Code — both AI and humans create and run workflows.

![Stack](https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun)
![Stack](https://img.shields.io/badge/React_19-Frontend-61dafb?logo=react)
![Stack](https://img.shields.io/badge/Hono-API-e36002?logo=hono)
![Stack](https://img.shields.io/badge/SQLite-Database-003b57?logo=sqlite)
![License](https://img.shields.io/badge/License-MIT-green)

## What is OpenConclave?

OpenConclave lets you build visual workflows that orchestrate AI agents (Claude Code, Ollama), code execution (Python, Node.js, Bash), and external services (Telegram, MCP tools, Playwright). It runs on your machine with zero external dependencies.

**Key differentiator:** Claude Code can both create workflows programmatically and receive results back via a custom channel — making it both the builder and the consumer.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-repo/openconclave.git
cd openconclave
bun install

# Start (server + client)
bun start
```

Open http://localhost:5173 — server runs on http://localhost:4000.

## Features

### Visual Workflow Editor

Drag-and-drop workflow builder powered by React Flow:

- **5 node types:** Trigger, Agent, Condition, Code, Output
- Snap-to-grid canvas with minimap and zoom controls
- Edge colors match source node type
- Active node highlighting during execution (pulsing animation)
- Node inspector panel for configuring each node
- Run/Stop toggle with live status

### Dual AI Engine

Run agents on Claude Code or Ollama — mix them in the same workflow:

**Claude Code agents:**
- Spawns `claude -p` CLI with full tool access
- Model selection: Haiku, Sonnet, Opus
- Configurable tools: Bash, Read, Write, Glob, Grep, WebFetch, WebSearch
- MCP server support: Playwright, Telegram, Filesystem, Fetch
- Budget limits and max turns

**Ollama agents (local):**
- Auto-detects Ollama installation and available models
- Native tool calling via Ollama's API
- MCP bridge: connects to MCP servers, converts tools to Ollama format
- Full tool-calling loop with multi-turn support
- Free, private, runs entirely on your hardware

### Workflow Execution Engine

Queue-based graph walker with advanced flow control:

- **Fan-out:** parallel execution via `Promise.all` — multiple agents run simultaneously
- **Fan-in:** nodes with multiple inputs wait for all predecessors to complete, receive merged array
- **Loops:** condition nodes route back to earlier nodes for iterative workflows
- **Tap pattern:** side-effect nodes (loggers, notifiers) fire per-input without blocking the main chain
- **Safety:** configurable max iterations (default 100) prevents infinite loops
- Each node passes its output as input to the next — agents are isolated

### Node Types

**Trigger** — starts a workflow:
- Manual (click Run in UI)
- Cron (scheduled, e.g., `* * * * *`)
- Webhook (HTTP POST)
- Channel (triggered from Claude Code)
- Telegram (messages from a specific chat)
- Optional input prompt for manual/cron triggers

**Agent** — AI task execution:
- Claude Code or Ollama engine
- Prompt + optional system prompt
- Tool and MCP server selection
- Input from previous node injected into prompt

**Condition** — branch logic:
- JavaScript expression evaluated against input
- True/False output handles for routing
- Safe expression evaluator (blocks injection patterns)

**Code** — script execution:
- Python, Node.js, or Bash runtime
- Input via stdin + `$INPUT` env var
- Output via stdout (auto-parsed as JSON if valid)
- Runs in project root directory

**Output** — deliver results:
- Log (server console)
- Claude Code (channel push to active session)
- Telegram (send to specific chat ID)
- Webhook, File, Notification (planned)

### Claude Code Integration

**MCP Server** — control OpenConclave from Claude Code:
- `list_workflows`, `get_workflow`, `create_workflow`, `update_workflow`, `delete_workflow`
- `trigger_workflow`, `list_runs`, `get_run`, `cancel_run`
- `get_schedule`, `pause_workflow`, `resume_workflow`
- `get_agent_status`, `get_dashboard`

**Channel** — receive workflow results in your terminal:
- Custom Claude Code channel via `--dangerously-load-development-channels`
- Only "Claude Code" output nodes push events — no noise
- Bidirectional: trigger workflows and receive results in the same session
- Works alongside Telegram channel

```bash
claude --dangerously-load-development-channels server:openconclave-channel
```

### Telegram Integration

- **Trigger:** server polls Telegram API directly — no Claude Code session needed
- **Output:** send workflow results to any Telegram chat
- **Bot commands:** `/start` and `/chatid` reply with the user's chat ID
- **Settings:** configure bot token via the UI (Settings page)

### Cron Scheduler

- Scan workflows for cron triggers every 60 seconds
- Check for due jobs every 15 seconds
- Pause/resume from the UI (workflow list toggle button)
- Immediate sync when toggling — no waiting
- Next run time displayed on workflow cards and dashboard

### Dashboard

- **5 stat cards:** Workflows, Active Runs, Total Runs, Success Rate, Total Cost
- **Run Results chart:** success/failed/cancelled bar visualization
- **Quick Launch:** one-click workflow triggers
- **Active Schedules:** cron jobs with next run times
- **Recent Runs:** clickable links to run details
- **Recent Outputs:** last channel/telegram outputs

### Run Details

- Summary card with status, duration, task count, cost
- Expandable agent tasks showing prompt, input, output, error
- Expandable events timeline with full JSON data
- Auto-polling while run is active (2-second refresh)

### Settings

- Telegram Bot Token (masked input with show/hide)
- Ollama URL
- Max Concurrent Agents

## Architecture

```
openconclave/
├── packages/
│   ├── shared/          # Types, Zod schemas, AppError, constants
│   ├── server/          # Bun + Hono API server
│   │   ├── agent/       # Claude CLI + Ollama runtimes + MCP bridge
│   │   ├── engine/      # Workflow executor + graph + scheduler
│   │   ├── triggers/    # Telegram polling
│   │   ├── channel/     # Claude Code channel (MCP stdio)
│   │   ├── mcp/         # OpenConclave MCP server
│   │   ├── routes/      # REST API endpoints
│   │   ├── db/          # Drizzle ORM + SQLite + migrations
│   │   └── lib/         # Logger, error middleware, expression evaluator
│   └── client/          # Vite + React 19 frontend
│       ├── components/  # Editor, dashboard, layout, UI
│       ├── pages/       # Dashboard, workflows, runs, settings
│       ├── stores/      # Zustand (editor state)
│       └── hooks/       # Typed React hooks
├── .mcp.json            # MCP server + channel config
├── start.ts             # Single-command launcher
└── CLAUDE.md            # AI coding conventions
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Frontend | React 19, Vite, Tailwind CSS v4, React Flow v12 |
| Backend | Hono, Drizzle ORM, SQLite (bun:sqlite) |
| State | Zustand, TanStack Query (planned) |
| Testing | Vitest (36 tests) |
| AI Engines | Claude Code CLI, Ollama |
| Protocols | MCP (Model Context Protocol), WebSocket |
| Integrations | Telegram Bot API, Playwright MCP |

## Code Quality

- TypeScript strict mode (`noUncheckedIndexedAccess`, `noUnusedLocals`)
- Zero `as any` casts across the entire codebase
- `AppError` class with typed error codes
- Structured logger (no `console.log`)
- Safe expression evaluator (blocks injection)
- Hono error middleware for consistent API responses
- Co-located Vitest tests
- Proper CLAUDE.md with coding conventions

## API

All endpoints at `http://localhost:4000/api/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server status |
| GET | `/dashboard` | Aggregated stats |
| GET/POST | `/workflows` | List/create workflows |
| GET/PUT/DELETE | `/workflows/:id` | Get/update/delete workflow |
| POST | `/workflows/:id/run` | Trigger a run |
| GET | `/runs` | List runs with cost/duration |
| GET | `/runs/:id` | Run detail with tasks/events |
| POST | `/runs/:id/cancel` | Cancel a run |
| GET | `/agents/status` | Running/queued agents |
| GET | `/agents/pool` | Agent pool stats |
| GET | `/ollama/status` | Ollama detection + models |
| GET/PUT | `/settings` | App settings |
| GET | `/scheduler` | Cron schedule |
| POST | `/scheduler/sync` | Force scheduler sync |
| POST | `/triggers/telegram` | Telegram trigger endpoint |

## Example Workflows

**URL Health Checker:**
Trigger → Agent (create CSV from URLs) → Code (Python: fetch each URL, fill status/size) → Output

**Parallel Code Review:**
Trigger → [Haiku + Sonnet + Opus] (parallel) → Output (merged array of 3 reviews)

**Poem Loop:**
Trigger ("first line") → Poet (add line) → Checker (4 lines?) → Condition → loop back or → Output

**Telegram Bot:**
Telegram message → Agent (process request) → Output (reply to Telegram)

## License

MIT
