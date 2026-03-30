# Workflows as MCP Tools

## Concept

Each enabled workflow with a `toolName` becomes a callable MCP tool.
Claude Code sees workflows as native tools and invokes them based on description.

## Example

Workflow "Code Review Pipeline" with toolName `code_review`:
```
Claude sees: code_review(file: string) — "Parallel code review by 3 models"
Claude calls: code_review({file: "src/executor.ts"})
→ triggers workflow → result comes back via channel
```

## Workflow Fields Needed

- `toolName: string` — MCP tool name (user-defined, fallback to slugified workflow name)
- `description: string` — already exists, used as tool description
- `inputSchema: object` — defines what parameters the tool accepts (maps to trigger payload)

## MCP Server Changes

1. On `tools/list`, include one tool per enabled workflow with toolName set
2. On tool call, trigger the workflow with arguments as payload
3. Use `listChanged` notification when workflows are created/updated/deleted

## Dynamic Tool Registration

The MCP protocol supports `notifications/tools/list_changed`:
```ts
server.notification({ method: "notifications/tools/list_changed" });
```

Our MCP server already declares `tools: { listChanged: true }` capability.

## Change Detection

Options:
1. **Polling** — MCP server polls `/api/workflows` every N seconds, compares
2. **WebSocket** — MCP server subscribes to workflow changes via WS
3. **Server push** — API notifies MCP server when workflows change

Option 2 is cleanest — MCP server connects to WebSocket (already does for channel events),
subscribes to a `workflows` topic, gets notified on create/update/delete.

## Implementation Steps

1. Add `toolName` and `inputSchema` fields to WorkflowDefinition
2. Add UI fields in workflow editor header
3. MCP server: generate tools from workflow list on `tools/list`
4. MCP server: handle workflow tool calls → trigger_workflow
5. MCP server: subscribe to workflow changes via WebSocket
6. MCP server: emit `notifications/tools/list_changed` on change
7. Test: create workflow → Claude sees new tool → calls it → gets result
