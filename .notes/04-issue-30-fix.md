# 04 — Fixing issue #30 via in-process `mcp__oc__*` tools

**Conclave**: 10 "Review Fix" (`oc_review_fix`)
**Runs this entry covers**: 58, 59
**Commits from this arc**: `077da22` (the fix), `830b7da` (runtime.ts review findings), `ad84074` (llm-call.ts review findings), `b197572` (code.ts review findings — see entry 05)

## Objective

Bypass the Claude Code CLI's broken filesystem path resolution by routing Read/Write/Edit/Grep/Glob/Bash through OpenConclave's in-process SDK MCP server. The CLI never touches those files, so it cannot escape them to the main tree.

## Key discovery

Before writing any code, I checked what OC already had:

```
packages/server/src/agent/builtin-tools.ts:19
  createBuiltinTools(workspace?: Workspace) → {
    bash, read_file, write_file, edit, glob, grep, ...
  }
```

**OC already had workspace-scoped filesystem tool implementations.** They all used `workspace.resolve(path)` explicitly. The Ollama and OpenAI agent paths used these directly, which is why Ollama was immune to issue #30.

Only the Claude path went through the SDK's `tools: ["Read", "Write", …]` option — which routes to the CLI subprocess's own builtins, not to OC's implementations.

**The fix was wiring, not new code.** Wrap OC's existing `createBuiltinTools(workspace)` handlers as in-process SDK MCP tools, register them under a server named `oc`, and filter the SDK query's `tools` option to exclude the filesystem builtins.

## Implementation (commit `077da22`)

In `packages/server/src/agent/runtime.ts`, inside `runClaudeAgent`, after the workspace is resolved:

```ts
const ocBuiltins = createBuiltinTools(ws);
const ocFsTools = [
  tool("read",  "Read a file…",   { path: z.string() }, async ({path}) => …),
  tool("write", "Create or overwrite…", { path, content }, async (args) => …),
  tool("edit",  "Modify a file by replacing an exact substring…", …, …),
  tool("grep",  "Search file contents for a regex…", …, …),
  tool("glob",  "List files by glob…", …, …),
  tool("bash",  "Run a shell command…", { command }, async ({command}) => …),
];
mcpServers["oc"] = createSdkMcpServer({ name: "oc", version: VERSION, tools: ocFsTools });

// Filter the SDK's tools list to exclude the builtins we replaced
const OC_REPLACED_BUILTINS = new Set(["Read", "Write", "Edit", "Grep", "Glob", "Bash"]);
const passthroughTools = (config.allowedTools ?? []).filter((t) => !OC_REPLACED_BUILTINS.has(t));

query({ prompt, options: { …, tools: passthroughTools, mcpServers, … } });
```

Each tool handler delegates to OC's existing `ocBuiltins.<name>.execute(args)` and wraps the string result in the MCP `content` array shape. The model sees the tools under their namespaced names (`mcp__oc__read`, `mcp__oc__write`, etc.).

Descriptions intentionally use natural language that differentiates similar tools — e.g. `edit` says "prefer this over write for existing files"; `grep` says "for finding file names instead, use glob"; `bash` says "prefer the specialized tools when they fit". This helps the model pick correctly given six tools that all touch the filesystem.

**`tools: passthroughTools`** means if the agent declared no builtins, we pass `[]` — removing the preset default that would have snuck the broken CLI builtins back in.

## Verification

### Run 58 — `oc_review_fix` on `.reviews/20260411-211453-runtime.ts.md`

- Worktree `.worktrees/review-fix/58/`: committed hash `4fbbe34` with 1 `package.json` + 1 `runtime.ts` modification
- Main tree `git status --short`: **empty**
- Teardown reported `committed: true`

**Issue #30 resolved.** First fully clean run of `oc_review_fix`.

Caveat: the Summarizer's "Fixes applied" section claimed "one-token change: error-path early return" but the actual worktree diff showed ~50 lines across 9 findings. The Implementer did all the work correctly; the Summarizer under-reported it. Separate hallucination class, fixed later in entry 06.

Also caveat: `package.json` changed to `>=0.2.92` again (the Implementer ignored the known-bad SDK version). I cherry-picked only `runtime.ts`, dropped the package.json change, cleaned up the worktree. Committed as `830b7da` "Apply review-fix run 58 fixes to runtime.ts".

### Run 59 — `oc_review_fix` on `.reviews/20260411-211515-llm-call.ts.md`

- Worktree committed `22988943` with 3 files: `llm-call.ts` (79 / 25), `runtime.ts` (2 / 1, just `export` on `ALLOWED_MODELS`), and a new `llm-call.test.ts` (183 lines, 23 tests)
- Main tree `git status --short`: **empty**
- One channel-loop question from the Verifier about `OLLAMA_URL` validation scope — I answered with the "allow loopback for local Ollama, block everything else" pattern. Implementer correctly synthesized `isAcceptableOllamaUrl()` with the guidance.

Ran the new test file: **23/23 passing**. Cherry-picked all three files to main, committed as `ad84074`.

## What the two clean runs produced

**runtime.ts (from run 58)**: 9 fixes landed.
- BLOCKER: error-path early return now forwards `routingState.routeContent` / `routeTo` / `sessionId`
- MAJOR: `openconclave_next` double-call guard (returns `isError: true` on second call)
- MAJOR: `top_k` Zod schema bounded with `.int().min(1).max(100)`
- MAJOR: `knowledge_add.filename.max(255)` / `content.max(500_000)`
- MINOR: `RouteTarget` imported from `engine/types`, local fork deleted
- MINOR: `CONCLAVE_MCP_SERVER_ID` constant extracted
- MINOR: "You MUST call this exactly once" nudge removed from `openconclave_next` description
- NIT: `chmodSync` catch now re-throws on non-EPERM
- NIT: `modelMap` → `ALLOWED_MODELS` Set

**llm-call.ts (from run 59)**: 10 fixes landed.
- **IPv4-mapped IPv6 SSRF bypass closed** (CVE-class — the one I introduced in my manual fix pass)
- OpenAI `JSON.parse(tc.function.arguments)` try/catch with tool name in error
- `providerRow.value` `JSON.parse` try/catch with provider ID
- `OLLAMA_URL` validated at module init via `isAcceptableOllamaUrl` (loopback allowed)
- `ENGINE_DEBUG`/`OLLAMA`/`OPENAI`/`CLAUDE` constants extracted
- Default engine case now throws instead of silently falling through to Claude
- `taskResult[0]` null-check moved into try block
- `JSON_SCHEMA_MAX_DEPTH` tightened 20 → 10
- `msg.tool_calls[0]!` / `choice.tool_calls[0]!` non-null assertions (strict-null cleanups)
- `isPublicHttpUrl` and `isAcceptableOllamaUrl` exported so the tests can import them

Plus the new `llm-call.test.ts` with 16 isPublicHttpUrl cases, 7 isAcceptableOllamaUrl cases, and 1 malformed-JSON integration test. 23 tests. All passing.

## Observations

- **In-process MCP tools are the correct boundary** for workspace filesystem ops. The CLI's bugs can't reach through because the CLI never sees these calls.
- **Wrap existing code, don't rewrite.** Finding `createBuiltinTools` already in place saved hours.
- **Agents did NOT need to be told to use `mcp__oc__*` tool names.** When the builtins are filtered out of `tools:`, the model naturally reaches for whatever filesystem tools are visible — and the mcp-prefixed versions are the only ones. No prompt migration needed for existing conclaves.

## What wasn't great

- **Summarizer under-reported what the Implementer did in both runs.** It's a prompt bug, fixed in entry 06.
- **Implementer scope-crept onto deferred minors without explicit user guidance.** Both runs applied every verified finding including minors I'd normally defer. Works when the cherry-pick phase can exclude things, but the discipline should be in the Implementer prompt.
- **Bumping SDK back to `>=0.2.92` happened twice**, once in run 55 and once in run 58. That's a real "lesson not yet captured in the KB" — next session I should write a lesson about "don't revert the SDK pin".

## Conclusions

Issue #30 is closed at the architectural level, not just worked around. Any future scenario that wants workspace filesystem isolation gets it for free via `mcp__oc__*`. Bonus: the invariant "every filesystem op goes through a boundary that knows `ws.cwd`" is now a real, enforceable thing.

## Next

Ship the fix. Entry 05: v1.0.9 release, plus a fresh dogfood review on `code.ts` (run 60) that produced 8 more real findings.
