# Better openconclave-dev MCP tools

A plan for expanding the openconclave-dev MCP server (the one exposed to Claude Code via the `openconclave-dev` plugin) so that Claude stops doing `curl + bun -e` gymnastics for things the server already knows how to answer in structured form.

## Why this matters now

This session ran 5+ pipeline runs and ~15 teach-agent-style audits. In each audit I did the same sequence by hand:

1. `curl -s /api/runs/:id > /tmp/run.json`
2. `bun -e '...parse events, filter by type, group by task, count thinking blocks, format output...'`

That is wrong twice over. First, it makes every audit brittle to the event shape and wastes 40+ lines of Bun code per invocation. Second, it loads the entire run JSON into Claude's context every time — which is expensive on big runs and invites me to skim rather than reason.

The server already has all this data in structured form. The MCP should surface it pre-parsed so Claude can reason in tool-calls, not in log-grep one-liners.

## What the dev MCP has today

Current tools in `packages/server/src/mcp/server.ts`:

- `list_workflows`, `get_workflow`, `create_workflow`, `update_workflow`, `delete_workflow`
- `list_runs`, `get_run`, `cancel_run`
- `get_agent_status`, `get_dashboard`, `get_schedule`
- `pause_workflow`, `resume_workflow`, `trigger_workflow`
- `list_mcp_servers`, `register_mcp_server`, `remove_mcp_server`

Gap: everything is either a list/CRUD wrapper or a dashboard hint. There is nothing that answers the questions I actually ask when debugging a run, auditing an agent, or teaching a lesson.

## Tools to add (sorted by pain-killing impact)

### Tier 1: the ones that would have saved most of this session

**`audit_run(runId, { compareWithPriorRun?: number })`**

Returns a structured audit report for a completed or in-flight run:

```ts
{
  runId: number,
  status: "running" | "success" | "failure" | "cancelled" | "interrupted",
  startedAt: string,
  completedAt: string | null,
  totalDurationMs: number,
  tasks: Array<{
    taskId: number,
    nodeId: string,
    nodeLabel: string,
    status: "running" | "success" | "failure" | "interrupted",
    durationMs: number | null,
    thinkingBlockCount: number,
    outputChunkCount: number,
    asksUser: Array<{ question: string, response: string | null, durationMs: number | null }>,
    firstThinkingSample: string,  // first 400 chars of first thinking block
    lastThinkingSample: string,   // last 400 chars of last thinking block
    error: string | null,
  }>,
  channelEventsCount: number,
  hallucinations: Array<{ taskId: number, kind: "file_not_found" | "function_not_found", reference: string }>,  // optional, requires filesystem scan
  ruleChecks: {  // only populated for tasks whose prompts include known rules
    reviewerUsedGitDiff: boolean | null,
    summarizerSkippedTestRerun: boolean | null,
    researcherSkippedWebSearch: boolean | null,
  }
}
```

Replaces the 40-line bun-parse block I've been writing for every audit. The `compareWithPriorRun` arg lets us diff against a baseline for "did things improve run-over-run."

**`run_thinking(runId, { taskId?: number, truncate?: number })`**

Returns just the thinking blocks from a run, optionally filtered to one task, with each block truncated to N chars (default 2000). Used during active debugging when you want to see what an agent was thinking without loading the whole run JSON.

```ts
{
  runId: number,
  tasks: Array<{
    taskId: number,
    nodeId: string,
    blocks: Array<{ index: number, content: string, truncated: boolean }>
  }>
}
```

**`run_events(runId, { types?: string[], since?: string, limit?: number })`**

Filtered event stream. Types can be `["agent:thinking", "prompt:question", "node:completed", ...]`. `since` is an ISO timestamp to fetch only new events after a previous poll. `limit` caps the response size.

```ts
{
  runId: number,
  events: Array<RunEvent>,
  latestTimestamp: string  // for use as next `since`
}
```

Replaces the curl + bun filter pattern I've been using in cron-based monitoring.

**`update_agent_config(workflowId, nodeLabelOrId, configPatch)`**

Partial update of one agent's config. Replaces the "fetch whole workflow, mutate in JS, PUT whole workflow" dance I've been doing in `scripts/update-tech-task-prompts.ts` and `scripts/fix-tech-task-setup.ts`.

```ts
// Example
update_agent_config(32, "Reviewer", {
  systemPrompt: "new prompt...",
  maxTurns: 50,
})
```

Server-side: fetch the workflow, find the matching node by label or id, shallow-merge the config patch, re-validate, save. Returns the new full node.

### Tier 2: knowledge base operations

Currently the dev MCP has ZERO knowledge base tools. Every ingest/search/delete in this session was a `curl -X POST /api/knowledge/:id/...` with a hand-built JSON payload. Add these four:

**`kb_list()`** — list all knowledge bases with id, name, doc count.

**`kb_ingest(kbId, { filename, text })`** — ingest a markdown document, returns `{ documentId }`.

**`kb_search(kbId, { query, topK })`** — vector search, returns ranked hits.

**`kb_delete_document(kbId, documentId)`** — delete a document.

These map 1:1 to the existing HTTP routes in `packages/server/src/routes/knowledge.ts`. No new server logic needed, just MCP wrapper tool definitions.

### Tier 3: pipeline control and inspection

**`trigger_workflow_by_name(toolName, input, cwd?)`** — trigger by `toolName` not numeric id. Removes a class of "is this workflow 32 or 28?" confusion. The channel plugin already exposes workflows this way (`techtask(...)`, `codereview(...)`) but the dev MCP requires numeric ids.

**`run_tail(runId, { maxSeconds?: number })`** — **blocking** call that waits up to `maxSeconds` and returns whenever the run transitions to a terminal state, OR a new `prompt:question` event arrives (the kind a user should respond to). Returns the reason for returning. Lets Claude write `await run_tail(411)` instead of polling via cron.

  This one is harder — it requires the server to either keep the HTTP request open with long-polling, or expose a WebSocket path the MCP stub can subscribe to. Probably worth it because it eliminates cron polling entirely.

**`patch_workflow_node_code(workflowId, nodeLabelOrId, code)`** — convenience for updating code nodes specifically. Same pattern as `update_agent_config` but for the code node's script. Would have saved me the `fix-tech-task-setup.ts` script entirely.

### Tier 4: probably not worth it now

Candidates I considered and ruled out for this round:

- **`stream_run_events(runId)`** as a streaming tool — MCP doesn't have great streaming semantics yet, and `run_tail` covers the blocking case.
- **`diff_workflows(idA, idB)`** — neat but not on the critical path.
- **`checkpoint_inspect(runId)`** — useful for the #27 resume bug but scope-crept.

## What I'm proposing to build in the first increment

**Tier 1 + Tier 2.** Eight new tools:

1. `audit_run`
2. `run_thinking`
3. `run_events`
4. `update_agent_config`
5. `kb_list`
6. `kb_ingest`
7. `kb_search`
8. `kb_delete_document`

All of them are thin wrappers over things the server already does in HTTP routes. Zero new business logic. Pure MCP surface expansion. Shouldn't be more than ~200 lines in `packages/server/src/mcp/server.ts`.

Build path:

1. Add the eight tool definitions to `mcp/server.ts`
2. `bun run scripts/build-release.ts` — ~1.5 minutes
3. User copies new `oc.exe` over and restarts
4. `/mcp` reconnect in Claude Code to pick up new tools
5. I retire `scripts/update-tech-task-prompts.ts`, `scripts/fix-tech-task-setup.ts`, and the curl-plus-bun polling patterns, replacing them with one-line MCP calls

## Risks

**Binary rebuild takes the server down.** The running `oc.exe` needs to be replaced. During rebuild, the currently-running Tech Task Pipeline run (411 or whichever is live) dies. Schedule this for a quiet moment, not while an audit is in progress.

**New tools expose more attack surface on the MCP.** These are all read-only or local-write operations (no destructive ops like delete_run). Default permissioning should be the same as existing dev MCP tools.

**Tool schema compatibility.** I need to be careful about argument shapes so that a future server rebuild with richer tool outputs doesn't break any skill that depends on the current shape. The `audit_run` shape especially: if I add new fields later, old consumers shouldn't break — always add, never remove.

## Not in scope for this plan

- Teaching the pipeline to use these new tools. That's a separate teach-agent pass after the tools ship.
- Adding these to the channel plugin as well (the channel plugin is for users, not Claude; different concerns).
- Rewriting the existing curl scripts in `scripts/` — I'd just delete them once the MCP tools land.

## What I want from you before building

1. **Go/no-go on Tier 1 + Tier 2.** If you want to cut scope, say so.
2. **Timing.** When do you want the rebuild? Best to wait until run 411 finishes so we don't waste its work.
3. **Anything I missed.** Pain points you've noticed that I haven't captured.
