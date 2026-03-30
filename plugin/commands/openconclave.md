---
name: openconclave
description: Open OpenConclave UI, list workflows, or trigger a run
args: [action]
---

OpenConclave quick actions. Usage: /openconclave [action]

Actions:
- `/openconclave` — show status and UI link
- `/openconclave workflows` — list all workflows
- `/openconclave run <name>` — trigger a workflow by name
- `/openconclave doctor` — check system health

Use the `oc_list_workflows` tool to list workflows, `oc_trigger_workflow` to run one, or just tell the user:

**OpenConclave UI**: http://localhost:4000 (API) / http://localhost:5173 (Editor)

If the server is not running, tell the user to run `bun start` from the OpenConclave directory, or restart Claude Code to trigger the auto-start hook.
