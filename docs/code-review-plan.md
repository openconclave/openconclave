# Code review plan

Systematic sweep of OpenConclave source via `light_code_review` (3 Sonnet specialists — Security, Correctness, Conventions — with cross-file render-storm + calibration passes). Organized by **risk dimension**, not by file size.

## Principles

- **Group by risk, not LOC.** A 150-LOC file at a trust boundary outweighs a 500-LOC static page.
- **Every file gets a hypothesis.** Focused review ("check X") consistently beats "review this file."
- **Three kinds of action, three distinct statuses.**
  - `[ ]` todo
  - `[~]` reviewed, findings deferred
  - `[x]` reviewed + findings handled
  - `[r]` refactored / split (review of the old unit no longer applies — the pieces are covered below or are small enough to skip)
  - `[s]` skimmed only (no deep review; sanity pass)
  - `[p]` partial (touched during another change but not fully reviewed)
- **Refactor-first for heterogeneous files.** When one file blends unrelated responsibilities, split it before reviewing — the split itself surfaces the structure and each piece becomes reviewable or inherently simple.

## Running a review

```
Trigger light_code_review in the channel plugin with input = packages/<...>/<file>
Output lands in .reviews/<YYYYMMDD-HHMMSS>-<basename>.md (gitignored)
Review prompts live on conclave 28 (security / correctness / conventions / writer)
```

---

## Risk class 1: Trust boundaries

Files where untrusted input (user text, model output, HTTP body, file contents from outside the workspace) meets a sensitive sink (subprocess, file I/O, network, DB). **Highest-yield review targets.**

### Server

- [ ] `agent/web-fetch.ts` (398) — URL scheme filter, SSRF guards, attachments path resolution, headless-browser lifecycle
- [ ] `engine/nodes/code.ts` (369) — user-code subprocess, stdin envelope, path resolution, tree cleanup on abort
- [ ] `agent/mcp-bridge.ts` (396) — subprocess env scrubbing, tool-name collision, stdio lifecycle, process leaks
- [ ] `agent/chromium-manager.ts` (228) — subprocess + pipe drain + stream readers (type annotation just fixed; bug pass still pending)
- [ ] `agent/attachment-tools.ts` (194) — per-run attachments folder, path resolve boundary, size caps
- [ ] `engine/workspace.ts` (310) — `resolveInside` / `isInsideAllowed` — the load-bearing path-containment guard for the entire runtime
- [ ] `routes/knowledge.ts` (320) — upload size cap, content-type validation, ingest size limits
- [ ] `triggers/telegram.ts` (265) — external webhook entry, token handling, polling backoff
- [x] `agent/builtin-tools/bash.ts` (146) — subprocess env, pipe drain, timeout + cap [reviewed-by-tests]
- [x] `agent/builtin-tools/files.ts` (141) — read/write/edit caps, edit's empty-string guard
- [x] `agent/builtin-tools/search.ts` (177) — walk budget, dir skip, line cap
- [x] `agent/builtin-tools/web-fetch.ts` (35) — thin wrapper; relies on sibling web-fetch.ts

---

## Risk class 2: State machines and orchestration

Files whose bugs hide in interaction between paths — graph concurrency, abort races, session resume. Cross-function reasoning required.

- [ ] `engine/graph-walker.ts` (575) — cycle safety; concurrent agent-completion; abort propagation; skip set correctness
- [ ] `engine/agent-executor.ts` (424) — per-node executor, route validation, timeout/retry, session-id handling
- [ ] `engine/nodes/discussion.ts` (460) — multi-agent turn-taking, moderator opening turn, participant-set drift
- [ ] `engine/scheduler.ts` (181) — cron reconciliation, timezone handling, double-fire avoidance
- [ ] `engine/node-executor.ts` (204) — dispatch correctness, unknown-type fallthrough
- [ ] `engine/executor.ts` (150) — glue layer; likely small yield but central
- [x] `agent/runtime/index.ts` (158) — post-split orchestrator; small and reviewable [reviewed-by-split]
- [x] `agent/runtime/sdk-stream.ts` (163) — the SDK message loop; error-union discrimination [reviewed-by-split]
- [x] `agent/runtime/conclave-mcp-tools.ts` (342) — routing + ask_user + knowledge; closure state kept local [reviewed-by-split]

---

## Risk class 3: Provider integrations

Model adapter mismatch, tool-call parsing drift, error-surface inconsistency between providers.

- [ ] `agent/llm-call.ts` (480) — model dispatch, streaming contracts, retry handling across providers
- [ ] `agent/ollama.ts` (380) — tool-call parsing from text, streaming contract
- [ ] `agent/openai-chat.ts` (229) — function-call schema mismatch vs our tool schema
- [ ] `agent/openai-responses.ts` (229) — responses API quirks, tool surface
- [ ] `agent/base.ts` (374) — shared agent primitives (overlap with llm-call?)
- [p] `mcp/server.ts` (383) — discussion/file node-type bug fixed; full bug review still pending

---

## Risk class 4: Client live-load paths

Render-storm candidates under live WebSocket traffic. Apply the same two-axis fix pattern proven on `conclave-editor.tsx` (per-node fine-grained selectors + RAF batching).

- [ ] `pages/run-detail.tsx` (764) — **highest-likelihood next render storm.** Live event feed; check selector granularity and event-list mutation
- [ ] `pages/chat.tsx` (569) — chat UI during runs; incoming message stream
- [ ] `pages/conclaves.tsx` (713) — list view; refreshes under activity
- [ ] `pages/dashboard.tsx` (461) — aggregate counts; may subscribe broadly
- [ ] `components/editor/node-palette.tsx` (426) — drag/drop state, pending-drop ref
- [ ] `components/editor/node-inspector.tsx` (246) — inspector shell
- [ ] `components/editor/inspector/agent-fields.tsx` (461) — largest inspector; often edited during runs
- [ ] `components/editor/inspector/discussion-fields.tsx` (161)
- [ ] `components/editor/inspector/code-fields.tsx` (144)
- [ ] `components/editor/inspector/trigger-fields.tsx` (142)
- [ ] `components/editor/tool-picker.tsx` (145)
- [p] `components/editor/nodes/base-node.tsx` (292) — selector fix applied; broader review pending
- [p] `components/editor/nodes/discussion-node.tsx` (325) — selector fix applied; broader review pending

---

## Risk class 5: HTTP surface

CRUD endpoints, boot sequence, WS wiring. Shape and validation rather than orchestration.

- [ ] `routes/conclaves.ts` (296) — CRUD, ownership, validation, unique-name race
- [ ] `routes/mcp-registry.ts` (167) — MCP server registration
- [ ] `index.ts` (432) — route wiring, WS init, boot sequence
- [ ] `channel/openconclave-channel.ts` (443) — CC bridge (dev-only path, so lower severity)

---

## Risk class 6: Supporting / lower priority

Big files, low risk density.

### Server

- [ ] `db/migrate.ts` (137)
- [ ] `install.ts` (135)
- [ ] `knowledge/ingest.ts` (128)
- [ ] `agent/artifact-tools.ts` (small) — similar shape to attachment-tools

### Client

- [ ] `pages/onboarding.tsx` (890) — one-shot flow; visit after the live-load files
- [ ] `pages/knowledge.tsx` (806) — KB management; uses KB API
- [ ] `pages/settings.tsx` (348) — settings UI
- [ ] `components/editor/rounded-edge.tsx` (268) — custom edge rendering
- [ ] `components/editor/nodes/agent-node.tsx` (180)
- [ ] `pages/runs.tsx` (170)
- [ ] Remaining inspector fields + UI primitives (< 170 LOC each)

---

## Refactor candidates (split before reviewing)

Files where a monolithic review would miss the structure. Split first, then each piece is either small enough to trust or gets its own review.

- [ ] `client/pages/onboarding.tsx` (890) — multi-step flow; candidate for one file per step + shared shell
- [ ] `client/pages/knowledge.tsx` (806) — list view + detail + upload; likely three components
- [ ] `client/pages/run-detail.tsx` (764) — after the render-storm review: likely splits into event feed + agent tasks + run header
- [ ] `engine/graph-walker.ts` (575) — review first; if heterogeneous, split into discovery + execution + abort handling

Completed splits (already done — files below are superseded by their replacement folders):

- [r] `server/agent/runtime.ts` → `agent/runtime/` (9 files, 32–342 LOC each)
- [r] `server/agent/builtin-tools.ts` → `agent/builtin-tools/` (7 files, 13–201 LOC each)

---

## Done this session

| File | Status | Action |
|---|---|---|
| `client/stores/conclave-store.ts` | [x] | Reviewed runs 201/203/204; P0+P1 bugs fixed (history flush/clone/drag, UI-ephemeral-state leak) |
| `client/components/editor/conclave-canvas.tsx` | [x] | Reviewed run 200; P0+P1 bugs fixed (keydown guard, hook lifting, minimap cleanup, UUIDs, reconnect race) |
| `client/pages/conclave-editor.tsx` | [x] | Reviewed run 200; P0+P1 bugs fixed (selector granularity, WS unsubscribe, no-dual-poll, aria, revoke defer, save-fail revert); **UI-freeze root cause fixed** via RAF-batched activeNodeIds |
| `client/components/editor/nodes/base-node.tsx` | [p] | Per-node `.has(id)` selector fix (UI freeze) |
| `client/components/editor/nodes/discussion-node.tsx` | [p] | Same selector fix |
| `client/lib/ws.ts` | [p] | Added `unsubscribe()` method |
| `server/agent/runtime.ts` | [r] | Split into `runtime/` (9 focused files) |
| `server/agent/builtin-tools.ts` | [r] | Split into `builtin-tools/` (7 focused files) |
| `server/agent/chromium-manager.ts` | [p] | TS type annotation fix (`ReadableStreamReadResult` → `ReadableStreamDefaultReadResult` + `Promise<never>`). Full bug review pending |
| `server/mcp/server.ts` | [p] | `discussion`/`file` node-type unblocked by sourcing from shared `NODE_TYPES`. Full bug review pending |
| Prompt tuning on conclave 28 | [x] | Security lane locked down, Correctness got cross-file render-storm pass, Writer got severity calibration |

---

## Skip (low bug density, not worth the tokens)

- `packages/shared/` — types and Zod schemas
- `packages/client/src/components/ui/*` — presentational primitives
- `packages/client/src/components/layout/*` — static chrome
- Small UI leaf nodes (`trigger-node.tsx`, `condition-node.tsx`, `file-node.tsx`, `merge-node.tsx`, `output-node.tsx`, `transform-node.tsx`, `prompt-node.tsx`) — all < 120 LOC
- `scripts/` — build tooling, covered by manual verification
- Barrel / re-export files, `main.tsx`, `app.tsx`

---

## Progress

| Risk class | Todo | Partial | Done |
|---|---:|---:|---:|
| 1 — Trust boundaries | 8 | 0 | 4 |
| 2 — State machines | 6 | 0 | 3 |
| 3 — Provider integrations | 5 | 1 | 0 |
| 4 — Client live-load | 11 | 2 | 0 |
| 5 — HTTP surface | 4 | 0 | 0 |
| 6 — Supporting | ~15 | 0 | 0 |
| **Refactor candidates** | 4 | 0 | 2 |
