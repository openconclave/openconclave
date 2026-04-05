# Feature: Workflow Project Path (cwd)

## Summary

Every workflow must have a **default project path** (`projectPath`). When any workflow is triggered — manual, chat, channel, cron, webhook, telegram — all agents in that workflow run with `cwd` set to this path. The trigger payload can override it.

## Current State

- `_callerCwd` is extracted from MCP proxy payloads (Claude Code only) and passed to agents as `cwd`
- If triggered from UI (manual/chat), there is no `cwd` — agents run without a working directory
- No way to configure a default path per-workflow

## Requirements

### 1. Workflow Definition: add `projectPath` field

In `packages/shared/src/types/workflow.ts`, add an optional `projectPath: string` field to `WorkflowDefinition`. This is the default working directory for all agents in the workflow.

### 2. Workflow Editor UI: add project path input

In the workflow editor canvas/settings, add an input field for "Project Path" — the default folder agents will work in. Show it near the workflow name/description.

### 3. Graph Walker: resolve `cwd` with priority

In `packages/server/src/engine/graph-walker.ts`, resolve the effective `cwd` with this priority:

1. `_callerCwd` from trigger payload (highest — runtime override)
2. `workflow.projectPath` from workflow definition (default)
3. `undefined` (no cwd — current behavior as fallback)

The resolved `cwd` must be passed to every `executeNode()` call, same as today.

### 4. All trigger types must support path override

When triggering via:
- **Manual** (`POST /api/workflows/:id/run`): payload `{ _callerCwd: "/path" }` already works
- **Chat** (`POST /api/runs/:runId/message`): no change needed (uses existing run's cwd)
- **Channel** (MCP proxy): already sends `_callerCwd` — no change
- **Cron**: uses workflow's `projectPath` (no runtime override)
- **Telegram**: uses workflow's `projectPath` (no runtime override)
- **Webhook**: payload can include `_callerCwd` to override

### 5. Persist and display

- `projectPath` is saved as part of the workflow definition JSON (already in the `definition` column)
- Show the configured path in the workflow list/card if set
- Show the effective cwd in run details/events

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/src/types/workflow.ts` | Add `projectPath?: string` to `WorkflowDefinition` |
| `packages/server/src/engine/graph-walker.ts` | Resolve cwd: `_callerCwd ?? workflow.projectPath ?? undefined` |
| `packages/client/src/components/editor/panels/workflow-settings-panel.tsx` or equivalent | Add "Project Path" input field |
| `packages/client/src/components/editor/nodes/trigger-node.tsx` or canvas settings | Show projectPath in UI |

## Non-Goals

- This does NOT change how agents use `cwd` internally (that already works)
- This does NOT add per-node path overrides (all agents in a workflow share the same cwd)
- This does NOT validate the path exists (agents handle missing paths gracefully)

## Testing

- Create a workflow with `projectPath` set to a local folder
- Trigger manually from UI — agents should see files in that folder
- Trigger via channel with `_callerCwd` override — override takes precedence
- Trigger via cron — uses workflow's `projectPath`
- Workflow without `projectPath` — behaves as today (no cwd)
