---
description: "Use when the user asks about OpenConclave, wants to start/stop the server, create workflows, check workflow status, or learn about the orchestration platform. Triggers on: 'openconclave', 'start openconclave', 'create a workflow', 'workflow status', 'orchestration'."
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__openconclave__list_workflows
  - mcp__openconclave__create_workflow
  - mcp__openconclave__trigger_workflow
  - mcp__openconclave__get_run
  - mcp__openconclave__list_runs
  - mcp__openconclave__get_schedule
  - mcp__openconclave__pause_workflow
  - mcp__openconclave__resume_workflow
---

# OpenConclave

You are helping the user with OpenConclave — a self-hosted AI agent orchestration platform with visual workflow automation.

## What is OpenConclave?

OpenConclave lets users build visual workflows that orchestrate AI agents (Claude Code + Ollama), code execution (Python/Node/Bash), and external services (Telegram, Playwright, MCP tools). It runs locally with zero external dependencies.

## Installation

If OpenConclave is not installed, guide the user:

### Quick Install (recommended)

**Mac/Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/openconclave/openconclave/main/install.sh | bash
```

**Windows:**
```powershell
powershell -c "irm https://raw.githubusercontent.com/openconclave/openconclave/main/install.ps1 | iex"
```

### Manual Install
```bash
git clone https://github.com/openconclave/openconclave.git
cd openconclave
bun install
bun start
```

## Starting the Server

Check if the server is running by hitting the health endpoint:
```bash
curl -s http://localhost:4000/api/health
```

If not running, start it:
```bash
cd ~/.openconclave && bun start
# Or if cloned elsewhere:
cd /path/to/openconclave && bun start
```

The UI is at http://localhost:5173, API at http://localhost:4000.

## Creating Workflows

Use the MCP tools to create workflows programmatically. A workflow needs:
- **Nodes**: trigger, agent, condition, code, output
- **Edges**: connections between nodes

### Node Types

**Trigger** — starts a workflow:
- `manual`: click Run in UI
- `cron`: scheduled (e.g., `"0 9 * * *"` for 9am daily)
- `channel`: triggered from this Claude Code session
- `telegram`: triggered by Telegram message (needs chat ID)

**Agent** — AI task execution:
- `engine: "claude"` with model: haiku/sonnet/opus
- `engine: "ollama"` with ollamaModel: e.g., "qwen3.5:9b"
- Can have allowedTools (Bash, Read, etc.) and mcpServers (playwright, etc.)

**Condition** — branch logic:
- JavaScript expression evaluated against input
- Has "true" and "false" output handles

**Code** — run Python/Node/Bash:
- Input via stdin and $INPUT env var
- Output via stdout

**Output** — deliver results:
- `log`: server console
- `claude-code`: push to this Claude Code session via channel
- `telegram`: send to Telegram chat (needs chatId)

### Example: Create a simple workflow

```
Use create_workflow with:
- name: "Hello World"
- A manual trigger node
- An agent node with prompt "Say hello"
- A claude-code output node
- Edges connecting them in order
```

## Managing Workflows

- `list_workflows` — see all workflows
- `trigger_workflow` — run a workflow with optional payload
- `pause_workflow` / `resume_workflow` — control cron schedules
- `get_schedule` — see upcoming scheduled runs
- `list_runs` / `get_run` — check run history and results

## Workflow Patterns

**Fan-out**: One trigger → multiple agents (run in parallel)
**Fan-in**: Multiple agents → one output (waits for all, merges as array)
**Loop**: Agent → Condition → back to agent (iterative processing)
**Tap**: Side-effect nodes (loggers) connected to main chain without blocking

## Tips

- The channel output pushes results directly to this session
- Ollama agents can use MCP tools via the built-in MCP bridge
- Extended thinking is captured and visible in run details
- Cron schedules can be paused/resumed without deleting the workflow
- Each agent is isolated — only sees output from the previous node
