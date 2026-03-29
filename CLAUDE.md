# OpenConclave

Self-hosted AI agent orchestration platform with visual workflow automation.
Deep integration with Claude Code — both AI and humans create and run workflows.

## Stack

- Runtime: Bun
- Monorepo: Bun workspaces (`packages/shared`, `packages/server`, `packages/client`)
- Server: Hono + Drizzle ORM + SQLite (bun:sqlite)
- Client: Vite + React 19 + Tailwind CSS v4 + React Flow v12
- Testing: Vitest
- Agent engines: Claude Code CLI (`-p` mode) + Ollama

## Commands

- `bun start` — run server + client
- `bun run dev:server` — server only (port 4000)
- `bun run dev:client` — client only (port 5173)
- `bun test` — run all tests
- `bun run --filter server test` — server tests only
- `bun run --filter client test` — client tests only

## Code Conventions

- TypeScript strict mode — no `any` casts, no implicit `any`
- Named exports only — no default exports except route pages
- Functional components with typed props interfaces
- Co-located tests: `foo.ts` → `foo.test.ts` in same directory
- Errors use `AppError` class from `@openconclave/shared`
- Server routes use Zod validation via `@hono/zod-validator`
- All API responses follow `{ data }` or `{ error: { code, message } }` shape
- Use `logger` from `server/src/lib/logger.ts` — never `console.log`

## Architecture

- `shared/` — types, Zod schemas, error classes, constants
- `server/engine/` — workflow executor (queue-based, supports loops)
- `server/agent/` — Claude Code CLI + Ollama runtimes + MCP bridge
- `server/triggers/` — Telegram polling
- `server/channel/` — Claude Code channel (MCP over stdio)
- `client/components/editor/` — React Flow workflow canvas + node types
- `client/stores/` — Zustand stores for editor state

## Node Types

- Trigger: manual, cron, webhook, channel, telegram
- Agent: Claude Code or Ollama with optional tools/MCP servers
- Condition: JS expression, routes true/false branches
- Code: Python/Node/Bash script execution (stdin→stdout)
- Output: log, claude-code channel, telegram

## Testing Rules

- Test files next to source: `executor.test.ts`
- Use `describe`/`it`/`expect` from Vitest
- Mock external deps (Claude CLI, Ollama API, Telegram API)
- No snapshot tests — prefer explicit assertions
