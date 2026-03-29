# OpenConclave Plugin for Claude Code

Adds AI agent orchestration capabilities to Claude Code.

## Features

- **MCP Server** — control workflows, runs, and schedules from Claude Code
- **Channel** — receive workflow output events in your terminal
- **Skill** — `/openconclave` guides installation, setup, and workflow creation

## Installation

### One-liner

**Mac/Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/openconclave/openconclave/main/install.sh | bash
```

**Windows:**
```powershell
powershell -c "irm https://raw.githubusercontent.com/openconclave/openconclave/main/install.ps1 | iex"
```

This installs the full platform and configures the Claude Code plugin automatically.

### Manual

1. Clone and install OpenConclave:
   ```bash
   git clone https://github.com/openconclave/openconclave.git
   cd openconclave && bun install
   ```

2. Start the server:
   ```bash
   bun start
   ```

3. In Claude Code, the MCP server connects automatically via `.mcp.json`.

## Usage

- `/openconclave` — get help, create workflows, check status
- MCP tools are available in Claude Code automatically
- Channel events arrive when workflows produce "Claude Code" output

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_workflows` | List all workflows |
| `create_workflow` | Create a new workflow |
| `trigger_workflow` | Run a workflow |
| `pause_workflow` | Pause a cron workflow |
| `resume_workflow` | Resume a paused workflow |
| `get_schedule` | View cron schedules |
| `list_runs` | List recent runs |
| `get_run` | Get run details with tasks and events |

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/code) v2.1.80+
