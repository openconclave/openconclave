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
- Pre-built node types (Agent, Code, Merge, Condition) handle common patterns
- Friendly UI with clear labels, colors, and auto-layout
- `/create-workflow` skill helps build workflows from natural language

### Tertiary: Business Automation Users
- Automate repetitive tasks with AI agents (reporting, monitoring, content)
- Connect to external services via MCP tools (Playwright, Telegram, APIs)
- Schedule workflows on cron — daily digests, health checks, data pipelines
- Telegram integration for triggering workflows from mobile

## Core Architecture

### Agent Engines (current)
- **Claude Code CLI** (`-p` mode) — full tool access, `--resume` for multi-turn sessions
- **Ollama** (local) — free, private, with MCP bridge for tool calling + JSONL session persistence

### Agent Engines (planned)
- Microsoft Foundry
- OpenAI API
- OpenRouter (access any model)
- Google Gemini
- Custom API endpoints

### Node Types (8)
1. **Trigger** — start workflows (manual, cron, webhook, channel, telegram)
2. **Agent** — AI task execution with tool access and MCP servers
3. **Condition** — branch logic with JS expressions
4. **Code** — Python/Node/Bash script execution (stdin → stdout)
5. **Merge** — combine parallel outputs into keyed object
6. **Channel-in-the-loop** — pause workflow, ask Claude Code, resume with response
7. **Output** — deliver results (channel, telegram, log)

### Workflow Patterns
- **Sequential** — A → B → C
- **Parallel (fan-out/fan-in)** — A → [B, C, D] → Merge → E
- **Loops** — A → B → Condition → back to A
- **Routing** — Agent dynamically chooses next step via `openconclave_next` MCP tool
- **Tap** — side-effect nodes that don't block the main chain
- **Claude-in-the-loop** — agent asks Claude Code for input mid-workflow

### Integration Points
- **MCP Server** — control workflows from Claude Code (list, trigger, pause, get results)
- **Claude Code Channel** — push workflow outputs into your terminal session
- **Telegram** — trigger workflows from mobile, send results to chats
- **Workflow-as-MCP-Tool** — each workflow with a `toolName` becomes a callable tool
- **Playwright** — browser automation available to any agent (Claude or Ollama)

### Key Technical Features
- **Conversation history** — agents remember previous turns in loops
- **Claude `--resume`** — native multi-turn sessions for Claude agents
- **Ollama JSONL sessions** — file-based session persistence for local models
- **Extended thinking visibility** — see how agents reason in run details
- **Dynamic routing** — agents choose their own path via MCP tool calls
- **Perspective-dependent history** — each agent sees conversations from its own POV

## Design Philosophy
- **Layer above, not replacement** — extends Claude Code, doesn't compete with it
- **Single responsibility** — each agent does one thing well, no hero agents
- **Model-agnostic** — same workflow runs on Claude, Ollama, or any future engine
- **Self-hosted** — your data, your machine, zero external dependencies
- **Both humans and AI build workflows** — UI for humans, MCP/skill for Claude Code
- **Real MCP tools** — agents use proper tool calling, not text parsing hacks

## Tech Stack
- **Runtime**: Bun
- **Server**: Hono + Drizzle ORM + SQLite
- **Client**: Vite + React 19 + Tailwind CSS v4 + React Flow v12
- **Testing**: Vitest
- **Protocols**: MCP, WebSocket, Claude Code Channels

## What Makes It Different
1. **Deep Claude Code integration** — channel, MCP tools, workflows-as-tools, `--resume` sessions
2. **Dual engine** — Claude Code + Ollama in the same workflow
3. **MCP bridge** — local models use Playwright, Telegram, etc. via MCP
4. **Visual + programmatic** — build in UI or from Claude Code via skill
5. **Claude-in-the-loop** — workflows can ask Claude Code for decisions mid-execution
6. **Thinking visibility** — see agent reasoning in run details
7. **Dynamic routing** — agents choose their own path, not just fixed flows
