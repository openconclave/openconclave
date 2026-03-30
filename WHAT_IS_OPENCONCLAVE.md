# What is OpenConclave

## One-liner
Self-hosted AI agent orchestration platform with visual workflow automation and deep Claude Code integration.

## Purpose
OpenConclave lets you build, run, and manage multi-agent workflows visually. Connect AI agents, code execution, external tools, and human/AI-in-the-loop decision points into automated pipelines — all from a drag-and-drop editor or programmatically via Claude Code.

## Target Audience

### Primary: Developers using Claude Code
- Build workflows that extend Claude Code's capabilities
- Use OpenConclave as a visual orchestration layer on top of Claude Code CLI
- Create reusable automation that runs in the background (cron, triggers)
- Workflows become MCP tools — Claude Code discovers and calls them automatically

### Secondary: Vibe Coders & Low-Code Users
- Visual drag-and-drop editor — no code required for simple workflows
- Pre-built node types handle common patterns
- Friendly UI with distinct node shapes, colors, arrow markers, and auto-layout
- `/create-workflow` skill helps build workflows from natural language

### Tertiary: Business Automation Users
- Automate repetitive tasks with AI agents (reporting, monitoring, content)
- Connect to external services via MCP tools (Playwright, Telegram, APIs)
- Schedule workflows on cron with preset buttons (hourly, daily, weekdays, etc.)
- Telegram integration for triggering workflows from mobile

## Core Architecture

### Agent Engines (current)
- **Claude Code CLI** (`-p` mode) — full tool access, `--resume` for multi-turn sessions, model selection per node (Haiku/Sonnet/Opus), budget + max turn config
- **Ollama** (local) — free, private, with MCP bridge for tool calling, JSONL session persistence, thinking toggle

### Agent Engines (planned)
- Microsoft Foundry
- OpenAI API
- OpenRouter (access any model)
- Google Gemini
- Custom API endpoints

### Node Types (7)
1. **Trigger** (pill shape) — start workflows (manual, cron, webhook, channel, telegram)
2. **Agent** — AI task execution with tool access and MCP servers
3. **Condition** — branch logic with JS expressions
4. **Code** — Python/Node/Bash script execution (stdin/stdout)
5. **Merge** — fan-in: wait for all inputs, combine into keyed object
6. **Channel Loop** (prompt) — pause workflow, ask Claude Code, resume with response
7. **Output** (pill shape) — deliver results (Claude Code channel, Telegram, log)

### Workflow Patterns
- **Sequential** — A -> B -> C
- **Parallel (fan-out/fan-in)** — A -> [B, C, D] -> Merge -> E
- **Loops** — A -> B -> Condition -> back to A
- **Dynamic routing** — agent with 2+ outputs MUST choose next step via `openconclave_next` tool call. 3 retries on failure; no silent fan-out.
- **Channel-in-the-loop** — agent asks Claude Code for input mid-workflow. Workflow pauses, sends question via channel with metadata (workflow name, sender node), resumes on response.

### Integration Points
- **MCP Server** — control workflows from Claude Code (list, trigger, pause, get results)
- **Claude Code Channel** — bidirectional: push workflow outputs to terminal, receive prompt responses back. Events include workflow name, node label, sender context.
- **Telegram** — trigger workflows from mobile, send results to chats
- **Workflow-as-MCP-Tool** — each workflow auto-generates a `tool_name` (snake_case from name), becomes a callable MCP tool. Names enforced unique.
- **MCP servers per agent** — Playwright, Telegram Voice, Filesystem, Fetch. Spawned on demand.

### Key Technical Features
- **Conversation history** — agents remember previous turns in loops
- **Claude `--resume`** — native multi-turn sessions for Claude agents
- **Ollama JSONL sessions** — file-based session persistence for local models
- **Ollama MCP bridge** — converts MCP tool schemas to Ollama format; local models use Playwright, web fetch, etc.
- **Extended thinking visibility** — see agent reasoning in run details
- **Dynamic routing** — agents choose path via `openconclave_next` tool call; works for both Claude (MCP state file) and Ollama (captured from tool call args)
- **Perspective-dependent history** — each agent sees conversations from its own POV
- **Startup recovery** — stale "running" runs marked "interrupted" on server restart (handles hot-reload crashes)
- **Prompt cleanup** — cancelled runs clear pending prompts from in-memory registry

### Observability
- **Run detail** — markdown-rendered agent tasks with node labels, expandable thinking blocks
- **Events timeline** — grouped by node, friendly labels (e.g., "Agent spawned", "Agent finished"), color-coded borders, time ranges
- **Cost tracking** — per-run and total cost, dashboard aggregate
- **Live execution** — WebSocket with pulsing node animation on the workflow canvas
- **Dashboard** — 5 stat cards, run distribution chart, quick launch, active schedules, latest outputs with workflow name

### Visual Editor
- **Distinct node shapes** — pill-shaped trigger/output (entry/exit), rectangular agents/conditions/code/merge/channel loop
- **Arrow markers** — directional arrows instead of animated dashes; color matches source handle (cyan, blue, purple)
- **Edge persistence** — sourceHandle, targetHandle, and colors survive save/reload
- **Connection handles** — all type="source" with connectionMode="loose" for any-to-any drag connections; direction always matches drag direction
- **Auto-layout** — dagre-based automatic node positioning
- **Cron presets** — quick buttons (Every 5m, Hourly, Daily 9am, Weekdays, etc.)
- **Auto tool_name** — snake_case generated from workflow name, enforced unique

### Data & Security
- **Workspace consolidation** — all data under `.openconclave/` (database, outputs, sessions, tmp). No files scattered in project root.
- **Security guidance** — `security_guidance.md` documents threat model: OpenClaw lessons, Lethal Trifecta, tool-specific risks, multi-agent cascade risks
- **Security Review workflow** — parallel Pattern Scanner + Architecture Reviewer, merge, risk classification, channel-loop confirmation, report generation

## Design Philosophy
- **Layer above, not replacement** — extends Claude Code, doesn't compete with it
- **Single responsibility** — each agent does one thing well, no hero agents
- **Model-agnostic** — same workflow runs on Claude, Ollama, or any future engine
- **Self-hosted** — your data, your machine, zero external dependencies
- **Both humans and AI build workflows** — UI for humans, MCP/skill for Claude Code
- **Real MCP tools** — agents use proper tool calling, not text parsing hacks
- **Fail loud** — routing failures throw errors, stale runs get recovered, no silent degradation

## Tech Stack
- **Runtime**: Bun
- **Server**: Hono + Drizzle ORM + SQLite (bun:sqlite)
- **Client**: Vite + React 19 + Tailwind CSS v4 + React Flow v12 + react-markdown
- **Testing**: Vitest
- **Protocols**: MCP, WebSocket, Claude Code Channels

## What Makes It Different
1. **Deep Claude Code integration** — channel, MCP tools, workflows-as-tools, `--resume` sessions
2. **Dual engine** — Claude Code + Ollama in the same workflow, parallel multi-model reviews
3. **MCP bridge** — local models use Playwright, Telegram, etc. via MCP tool conversion
4. **Visual + programmatic** — build in UI or from Claude Code via skill/MCP
5. **Channel-in-the-loop** — workflows pause and ask Claude Code for decisions, with full context metadata
6. **Thinking visibility** — see agent reasoning in run details (both Claude and Ollama)
7. **Dynamic routing** — agents choose their own path, enforced with retries and error on failure
8. **Crash resilient** — startup recovery, prompt cleanup, no orphaned runs
9. **Security-aware** — documented threat model, security review workflow, workspace isolation
