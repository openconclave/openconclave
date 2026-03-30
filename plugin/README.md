# OpenConclave Plugin for Claude Code

AI agent orchestration with visual workflow automation.

## Install

```bash
claude plugin install github:openconclave/openconclave
```

That's it. Next time you start Claude Code:
- Server auto-starts via SessionStart hook
- MCP tools auto-register (list/create/trigger workflows)
- Channel auto-connects (receive output, respond to prompts)
- `.openconclave/` created in your project for workflow data

## What You Get

- **Visual editor** at http://localhost:5173 — drag-and-drop workflows
- **MCP tools** — `oc_list_workflows`, `oc_trigger_workflow`, `oc_get_run`, etc.
- **Channel events** — workflow outputs and prompt questions arrive in your terminal
- **`/openconclave`** command — quick status and actions
- **`/create-workflow`** skill — build workflows from natural language

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_workflows` | List all workflows |
| `create_workflow` | Create a new workflow with nodes and edges |
| `trigger_workflow` | Run a workflow with optional payload |
| `get_run` | Get run details with tasks and events |
| `list_runs` | List recent runs |
| `cancel_run` | Stop a running workflow |
| `get_dashboard` | Dashboard stats |

## Channel Events

- `channel:output` — workflow produced output for you
- `prompt:question` — workflow is asking you a question (auto-respond with `oc_respond`)

## Plugin Structure

```
plugin/
  .claude-plugin/plugin.json   — manifest with MCP servers + channel
  hooks/hooks.json             — SessionStart auto-starts server
  hooks/start-server.sh        — server startup script
  skills/create-workflow/      — workflow creation skill
  skills/openconclave/         — general help skill
  commands/openconclave.md     — /openconclave slash command
```

## Requirements

- [Bun](https://bun.sh) runtime (auto-installed if missing)
- Claude Code
