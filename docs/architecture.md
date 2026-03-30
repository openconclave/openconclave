# Architecture

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Frontend | React 19, Vite, Tailwind CSS v4, React Flow v12, react-markdown |
| Backend | Hono, Drizzle ORM, SQLite (bun:sqlite) |
| State | Zustand |
| Testing | Vitest |
| AI Engines | Claude Code CLI, Ollama |
| Protocols | MCP (Model Context Protocol), WebSocket, Claude Code Channels |
| Integrations | Telegram Bot API, Playwright MCP |

## Project Structure

```
openconclave/
├── packages/
│   ├── shared/          # Types, Zod schemas, AppError, constants
│   ├── server/          # Bun + Hono API server
│   │   ├── agent/       # Claude CLI + Ollama runtimes + MCP bridge
│   │   ├── engine/      # Workflow executor + graph + scheduler + recovery
│   │   ├── triggers/    # Telegram polling
│   │   ├── channel/     # Claude Code channel (MCP stdio)
│   │   ├── mcp/         # OpenConclave MCP server
│   │   ├── routes/      # REST API endpoints
│   │   ├── db/          # Drizzle ORM + SQLite + migrations
│   │   └── lib/         # Logger, errors, expression evaluator, workspace
│   └── client/          # Vite + React 19 frontend
│       ├── components/  # Editor, dashboard, layout, UI
│       ├── pages/       # Dashboard, workflows, runs, settings
│       ├── stores/      # Zustand (editor state)
│       └── hooks/       # Typed React hooks
├── plugin/              # Claude Code plugin
│   ├── .claude-plugin/  # Plugin manifest
│   ├── hooks/           # SessionStart auto-start
│   ├── skills/          # Workflow creation skill
│   └── commands/        # /openconclave command
├── docs/                # Documentation
├── landing/             # openconclave.com landing page
└── CLAUDE.md            # AI coding conventions
```

## Data Layout

All project data lives in `.openconclave/` in the working directory:

```
.openconclave/
├── openconclave.db      # SQLite database
├── outputs/             # Channel output files
├── sessions/            # Agent session files (Claude --resume, Ollama JSONL)
└── tmp/                 # MCP configs, state files
```

## API Endpoints

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
| GET | `/ollama/status` | Ollama detection + models |
| GET/PUT | `/settings` | App settings |
| GET | `/scheduler` | Cron schedule |

## Execution Engine

Queue-based graph walker:
- **Fan-out** — parallel execution via `Promise.all`
- **Fan-in** — Merge nodes wait for all inputs
- **Loops** — Condition nodes route back for iteration
- **Dynamic routing** — agents with 2+ outputs choose via `openconclave_next` tool (3 retries, error on failure)
- **Startup recovery** — stale "running" runs marked "interrupted" on server restart
- **Prompt cleanup** — cancelled runs clear pending prompts

## Code Quality

- TypeScript strict mode
- Zero `any` casts
- `AppError` class with typed error codes
- Structured logger (no `console.log`)
- Hono error middleware for consistent API responses
- Co-located Vitest tests
