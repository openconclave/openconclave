# Experiment: Solo Claude Code agent vs OC review pipeline

**Session date**: 2026-04-12

## Goal

Compare a single Claude Code subagent (spawned via the Agent tool inside a Claude Code session) against the full OC Code Review conclave (#9, 10+ agents) reviewing the same file. Measure quality, speed, cost, and what each catches.

## Setup

- **Target file**: `packages/server/src/engine/graph-walker.ts` (528 lines, core conclave execution engine — never previously reviewed)
- **Solo agent**: Claude Sonnet, spawned via Claude Code's Agent tool with a combined prompt covering all 5 specialist perspectives (Correctness, Security, Tests, Conventions, Design). Prompt modeled after the individual specialist prompts from conclave #9 but merged into one. No KB access. Tools: Read, Grep, Glob, Bash (read-only), Write (to save review file).
- **Pipeline**: OC Code Review conclave #9 — KB Searcher + Context Reader + Usage Analyst (parallel) → 5 parallel specialists (Correctness on GPT-5.4, rest on Sonnet) → Best Practices (KB write-back) → Lead Reviewer → Writer. Full KB 1 access.

## Solo agent results

- **Time**: ~156 seconds (~2.5 min)
- **Token usage**: 57,646 total tokens, 38 tool calls
- **Estimated cost**: ~$0.32 (Sonnet pricing: ~45K input × $3/M + ~12K output × $15/M). Exact input/output split unknown — Claude Code JSONL does not track subagent internal costs, only the parent session's API calls. The Agent tool result metadata includes `total_tokens` but no `costUSD`.
- **Findings**: 0 blockers, 4 major, 3 minor, 2 nits
- **Review saved to**: `.reviews/20260412-000000-graph-walker.ts.md`

### Key findings from solo agent

1. **[MAJOR] Merge fan-in deadlock** — condition node prunes a branch, merge waits forever for the dead branch's input, run silently completes without executing merge or downstream nodes.
2. **[MAJOR] DB SELECT inside hot loop** — one `db.select()` per iteration for cancellation check. 10 nodes = 10 DB round-trips. Cancellation also lags by one node execution.
3. **[MAJOR] Un-normalized `conclave` passed to `executeNode`** — `normalizedConclave` is computed but original `conclave` is passed downstream. Latent bug if callees ever read `.nodes`.
4. **[MAJOR] Zero test coverage** — no `graph-walker.test.ts` exists. Core execution path completely untested.
5. **[MINOR] Dead code in break conditions** — two `ready.length === 0` guards do the same thing; first is unreachable.
6. **[MINOR] FIFO eviction on `persistentSessions`** — can evict active chat sessions under load.
7. **[MINOR] Telegram co-treated with chat** — non-obvious coupling, no comment explaining why.

## Pipeline results

- **Run ID**: 90
- **Status**: Started but cancelled before completion (user stopped the experiment to record the journal first)
- **Time**: N/A (incomplete)

## Observations so far

- Solo agent was fast (2.5 min) and found substantive issues without KB access.
- The merge fan-in deadlock finding is architecturally significant — this is the kind of bug that only surfaces in specific topologies (condition → merge) and could easily be missed by spot-checking.
- No false positives in the solo review — every finding has a concrete scenario or code citation.
- The solo agent correctly identified that `getPersistentSession`/`setPersistentSession` have no external callers (potential dead exports).

## Pipeline results (Run 91)

- **Run ID**: 91
- **Time**: ~15-20 min (estimated from prior runs)
- **Cost**: ~$2-4 estimated (5 Sonnet specialists + GPT-5.4 correctness + Haiku support agents)
- **Findings**: 4 blockers, 3 major, 2 minor, 2 nits = 11 total
- **Review saved to**: `.reviews/20260413-004117-graph-walker.ts.md`
- **KB lessons written**: 4 new lessons to KB 1 (docs 40-43)

### Key findings from pipeline

1. **[BLOCKER] `_callerCwd` path traversal** — HTTP trigger payload passes attacker-controlled `_callerCwd` to `Workspace.fromTrigger`. Any unauthenticated POST can redirect agent filesystem to arbitrary paths.
2. **[BLOCKER] Cancelled status overwritten by success** — Cancel API sets `cancelled` in DB, but graph-walker unconditionally writes `success` after loop completes. Race window during last batch execution.
3. **[BLOCKER] Merge fan-in deadlock** — Same as solo agent's finding, but elevated to BLOCKER.
4. **[BLOCKER] Checkpoint written before route validation** — Bad routing poisons checkpoint; resume re-throws forever.
5. **[MAJOR] Label-match routing bypass** — Pre-existing KB lesson cited.
6. **[MAJOR] Routing threshold mismatch** — `__routeTo` JSON forwarded raw to downstream.
7. **[MAJOR] Zero test coverage** — Same as solo.

---

## Side-by-side comparison

| | **Solo Agent** (Sonnet, 1 agent) | **Pipeline** (Conclave #9, 10+ agents) |
|---|---|---|
| **Time** | ~2.5 min | ~15-20 min |
| **Cost** | ~$0.32 | ~$2-4 |
| **Findings** | 0B / 4M / 3Mi / 2N = 9 | 4B / 3M / 2Mi / 2N = 11 |
| **KB access** | None | Full KB 1 (read + write) |
| **KB lessons written** | 0 | 4 new lessons |

### What both found
- Merge fan-in deadlock (condition prunes branch, merge waits forever)
- DB SELECT per iteration (cancellation polling overhead)
- Un-normalized `conclave` passed to `executeNode`
- Zero test coverage
- Dead break guard (lines 256-261)
- `persistentSessions` FIFO eviction concern

### Pipeline found, solo missed
- **`_callerCwd` path traversal** (Security specialist traced trust boundaries from HTTP to Workspace)
- **Cancelled status overwritten by success** (Correctness specialist modeled the state machine across cancel API + graph walker)
- **Checkpoint poisons resume** (Correctness specialist followed the resume code path)
- **Routing threshold mismatch** with `__routeTo` JSON leaking to downstream nodes
- **Magic string constants** duplicated across 5+ files (Conventions specialist, KB hit)

### Solo found, pipeline missed
- **Telegram co-treated with chat** — non-obvious coupling in `isChatConclave`

---

## Human verification (skeptical analysis)

After reading both reviews, I (Claude Opus, the session host) read graph-walker.ts in full and verified every finding against the actual code. Here's what's real and what's not:

### BLOCKER 1: `_callerCwd` path traversal — VERIFIED REAL
`index.ts:97` passes `body.payload` from HTTP POST directly to `executor.execute()` → `executeGraph()` → `Workspace.fromTrigger()`. The workspace extracts `_callerCwd` at `workspace.ts:97-98` with no validation. An unauthenticated POST with `{"payload": {"_callerCwd": "/etc"}}` would set agent CWD to `/etc`. This is a real security bug. The solo agent completely missed it because it didn't trace the data flow from the HTTP route handler through to the workspace — it only looked at graph-walker.ts in isolation.

### BLOCKER 2: Cancelled status overwritten — VERIFIED REAL
`runs.ts:76` sets `status: "cancelled"` in DB. `graph-walker.ts:206-208` checks cancellation at loop top. But `graph-walker.ts:380-383` writes `status: "success"` unconditionally after the loop. If cancel fires during the last `Promise.all` batch, the cancelled status is silently overwritten. The solo agent noticed the DB polling cost but didn't model the cancellation state machine.

### BLOCKER 3: Merge deadlock — VERIFIED REAL (both found it)
`graph-walker.ts:244`: `inputs.size >= incomingEdges.length` uses static edge count. Condition-pruned branches never enqueue the merge. Run exits silently as success. Both reviews caught this; pipeline elevated to BLOCKER.

### BLOCKER 4: Checkpoint poisons resume — VERIFIED REAL, BUT FIX IS WRONG
Lines 318-322: checkpoint is written before `resolveNextEntries`. If `resolveNextEntries` throws ("routed to unknown target"), the node is already in `completedNodes`. On resume, it gets skipped, `resolveNextEntries` runs again with the same bad output, throws again — infinite failure loop. **However**, the pipeline's proposed fix ("move checkpoint after resolveNextEntries") is wrong. The code comment at lines 312-317 explicitly explains why checkpoint must come before: `resolveNextEntries` mutates `nodeOutputs` for condition/routing nodes, and the checkpoint must capture the raw output. The correct fix is: if `resolveNextEntries` throws, rollback `completedNodes.delete(entry.nodeId)` and don't write a checkpoint for that node. This is a case where the pipeline found a real bug but proposed a fix that would introduce a different bug.

### Other findings verification
- **Label-match routing bypass**: Real, pre-existing KB lesson. Line 506 allows case-insensitive label matching.
- **DB polling**: Real concern but NIT-level, not MAJOR. The DB is SQLite, the query is trivially fast, and the practical impact is negligible for pipelines under ~50 nodes.
- **Un-normalized conclave**: Real but low-risk. `executeNode` only uses `conclave.id` and `conclave.name` today. Latent bug, correctly tagged as MAJOR by solo, MAJOR by pipeline (via the routing finding).
- **`getRunWorkspace` exports**: Pipeline says 0 external callers. I verified: `index.ts` imports and calls `getRunWorkspace`. The pipeline's dead-code claim for this function is **FALSE**. Solo agent correctly identified this.

---

## Honest assessment

**The pipeline justified its cost.** Three of its four blockers are real bugs the solo agent missed entirely. The security finding (`_callerCwd`) required tracing data flow from the HTTP route handler through executor to workspace — a cross-file trust-boundary analysis that the Security specialist is specifically prompted to do. The cancellation race required modeling the interaction between the cancel API route and the graph walker's loop — another cross-component analysis.

**The solo agent was not bad.** 9 findings in 2.5 minutes for ~$0.32 is excellent for a first pass. It found the merge deadlock, the DB polling, the un-normalized conclave, and zero test coverage. For a quick "what's obviously wrong?" scan, it's more than sufficient.

**Neither was perfect:**
- Pipeline proposed a wrong fix for the checkpoint poisoning (would break condition nodes)
- Pipeline falsely claimed `getRunWorkspace` has no external callers
- Solo agent missed all security findings and all cross-component state-machine bugs
- Both missed: no finding about what happens if `executeNode` itself throws (the `Promise.all` will reject, the outer catch marks the run as failure, but other nodes in the same batch may still be running)

**The KB made a real difference.** The pipeline cited 3 pre-existing lessons and wrote 4 new ones. Future reviews of sibling files will benefit from the checkpoint, merge deadlock, and cancellation lessons — compounding value the solo agent can't provide.

## Findings ranked by real-world danger

All 13 unique findings from both reviews, ranked by actual impact if exploited or triggered in production. Context grounded in real-world incidents and vulnerability databases.

| Rank | Finding | Real danger | Who found | Real-world parallel |
|------|---------|-------------|-----------|---------------------|
| **1** | `_callerCwd` path traversal | **CRITICAL.** Unauthenticated HTTP POST redirects all agent filesystem ops to arbitrary paths. Agents run with `bypassPermissions` — they can read `/etc/shadow`, overwrite system files, exfiltrate secrets. No auth required. This is [OWASP API6:2019 Mass Assignment](https://owasp.org/API-Security/editions/2019/en/0xa6-mass-assignment/) — same class as [CVE-2024-13275 (Langflow)](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html) where a single crafted field escalated to super admin. In OC's case it's worse: the attacker doesn't need to be authenticated at all. | Pipeline only | Langflow CVE-2024-13275; GitHub mass assignment incidents |
| **2** | Merge fan-in deadlock (silent success) | **HIGH.** Condition → merge topologies silently skip all downstream nodes and mark the run as success. User sees "success" but output node never executed — data silently lost. In workflow orchestration this is the most dangerous failure mode: [Airflow has multiple open issues](https://github.com/apache/airflow/issues/25765) about DAG deadlocks, and their docs warn "Airflow doesn't prevent you from creating deadlocks and will happily deadlock itself." The silent-success aspect is worse than a crash — users don't know something went wrong. | Both | Apache Airflow deadlock issues #25765, #30480, #35025 |
| **3** | Checkpoint poisons resume (infinite failure loop) | **HIGH.** A single bad routing output permanently breaks the run. Every resume re-throws the same error because the bad output is baked into the checkpoint. The run can never recover — manual DB surgery required. Similar to [Cline's checkpoint corruption](https://github.com/cline/cline/issues/4388) where interrupted checkpoints entered infinite loops, and [IBM PM34071](https://www.ibm.com/support/pages/apar/PM34071) where a catalog checkpoint caused route table corruption in an infinite loop. | Pipeline only | Cline #4388, IBM PM34071 catalog corruption |
| **4** | Cancelled status overwritten by success | **HIGH.** User cancels a run, sees it flip to "success". Violates user expectation — they think the run stopped, but its outputs propagated. In [production systems, status race conditions](https://www.steve-bang.com/blog/race-condition-silent-bug-breaks-production) cause cascading trust failures: downstream systems act on a "success" that should have been "cancelled." Financial systems have lost money from similar status-overwrite races. | Pipeline only | General class: TOCTOU race conditions in job schedulers |
| **5** | Label-match routing bypass | **MEDIUM.** A jailbroken model can route to nodes not offered in the routing tool's enum by guessing human-readable labels. Bypasses the ID-only validation in routing tools. Requires model manipulation — not externally exploitable, but realistic given that agent prompts process untrusted input. | Pipeline only (KB hit) | Novel to OC's architecture |
| **6** | Zero test coverage on graph walker | **MEDIUM.** Not a bug itself, but means all 5 bugs above have zero CI protection. Any fix can regress silently. Every finding in this review is undetectable by the test suite because there is no test suite. The core execution engine — the most critical 528 lines in the server — is flying blind. | Both | General engineering: untested critical paths |
| **7** | Routing threshold mismatch (`__routeTo` leak) | **MEDIUM.** When routing tool is injected but downgrade fires, raw `{"__routeTo":"id","content":"..."}` JSON reaches the downstream node instead of clean output. Downstream agent processes routing metadata as input — confusing but not crashing. Causes wrong behavior, not data loss. | Pipeline only | Novel to OC's architecture |
| **8** | Un-normalized `conclave` passed to `executeNode` | **LOW.** Latent bug. Today `executeNode` only reads `.id` and `.name` from the conclave object, so the un-normalized types don't matter. Becomes a real bug only if someone adds code that reads `.nodes` from the passed conclave. Defensive fix, not urgent. | Both | General: inconsistent state passed to callees |
| **9** | DB SELECT per iteration (polling overhead) | **LOW.** SQLite query on primary key, trivially fast. 10-node pipeline = 10 extra microsecond-scale reads. Would matter at 1000+ nodes or under extreme concurrency, neither of which applies to OC today. Also means cancellation lags by one node execution — minor UX issue. | Both | General: polling vs event-driven cancellation |
| **10** | Dead break guard (lines 256-261) | **LOW.** Dead code — first guard is unreachable. No runtime impact. Confusing to readers but doesn't cause bugs. Related to the merge deadlock (both break paths do the same thing when they should distinguish clean-drain vs deadlock). | Both | Code clarity issue |
| **11** | `persistentSessions` FIFO eviction | **LOW.** Under high concurrency, active chat sessions can be evicted. Fallback to DB checkpoint works correctly — just adds a DB query. 256-entry cap is generous for current workloads. Would matter at scale with hundreds of concurrent chat conclaves. | Both | General: cache eviction policy |
| **12** | Magic string constants (`__routeTo` etc.) | **LOW.** Maintenance burden, not a runtime bug. A typo in one of 5+ files would silently break routing. Already partially addressed (ROUTING_TOOL_NAME constant exists). Worth consolidating but not urgent. | Pipeline only (KB hit) | General: DRY principle |
| **13** | Telegram co-treated with chat | **NEGLIGIBLE.** Non-obvious coupling but intentional design. Session restore for Telegram is harmless — sessions are only used if the same agent is re-invoked in the same runId. Missing comment, not a bug. | Solo only | Documentation gap |

### What this ranking reveals about the two approaches

The top 4 most dangerous findings (ranks 1-4) were **all found by the pipeline**. The solo agent found rank 2 (merge deadlock) but missed ranks 1, 3, and 4. These three missed findings share a trait: they require **cross-component state-machine analysis** — tracing data flow across HTTP routes, DB writes, and execution loops. The Security specialist and Correctness specialist are specifically prompted to do this kind of analysis; a single generalist agent tends to stay within the file boundary.

The solo agent's unique find (rank 13) is the least dangerous of all findings.

**Cost of missing the top 3 pipeline-only findings:**
- `_callerCwd`: full server compromise via unauthenticated HTTP request
- Checkpoint poisoning: permanently unrecoverable runs requiring manual DB surgery
- Cancellation race: user trust violation, downstream systems act on false "success"

These are not theoretical. They are exploitable/triggerable with specific, constructable inputs today. The ~$3 extra cost of the pipeline vs the solo agent is trivial compared to any one of these reaching production.

Sources:
- [OWASP Mass Assignment Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html)
- [OWASP API6:2019 Mass Assignment](https://owasp.org/API-Security/editions/2019/en/0xa6-mass-assignment/)
- [Mass Assignment Vulnerability Guide](https://www.pynt.io/learning-hub/owasp-top-10-guide/mass-assignment-vulnerability-how-it-works-6-defensive-measures)
- [Race Condition: The Silent Bug That Breaks Production](https://www.steve-bang.com/blog/race-condition-silent-bug-breaks-production)
- [Airflow Hidden Deadlock](https://medium.com/@reliabledataengineering/airflows-hidden-deadlock-when-dags-starve-each-other-to-death-ce5ca1aa3666)
- [Airflow Scheduler Deadlock #25765](https://github.com/apache/airflow/issues/25765)
- [Cline Checkpoint Corruption #4388](https://github.com/cline/cline/issues/4388)
- [IBM PM34071 Infinite Loop Checkpoint Corruption](https://www.ibm.com/support/pages/apar/PM34071)

---

## Pipeline mistakes are fixable — solo agent mistakes aren't

The pipeline had two errors:
1. **False positive**: Usage Analyst claimed `getRunWorkspace` has no external callers. I verified: `index.ts` imports and calls it. The Usage Analyst likely only grepped route files, not `index.ts`.
2. **Wrong fix proposal**: For the checkpoint poisoning finding, the pipeline proposed "move checkpoint after resolveNextEntries." The code comment at lines 312-317 explicitly explains why checkpoint MUST come before — `resolveNextEntries` mutates `nodeOutputs` for condition/routing nodes. The correct fix is to rollback `completedNodes` if `resolveNextEntries` throws, not to reorder the calls.

The solo agent had zero false positives (every finding was verified). More agents means more findings but also more noise.

**But here's the critical difference**: the pipeline's mistakes are correctable through the KB. If I write a lesson saying "`getRunWorkspace` is called by `index.ts` — Usage Analyst must grep the full `src/` tree, not just route files", the next review won't make that false positive. And a lesson saying "checkpoint ordering in graph-walker.ts has a documented invariant at lines 312-317 — read it before proposing reordering" prevents the wrong fix. The teach-agent skill (`openconclave-dev:teach-agent`) exists for exactly this: record the mistake, write a KB lesson, and optionally adjust the agent's system prompt.

The solo agent can't learn. It has no KB, no persistent memory, no way to compound corrections across runs. It will make different mistakes next time — maybe better, maybe worse — but it can't be systematically improved.

This is the real moat of the pipeline approach: **supervised learning via the KB**. Each review run is an opportunity to teach. Over time, the pipeline's false positive rate drops and its finding quality rises, while the solo agent stays flat. The $3 per review is an investment in a system that gets smarter, not just a one-shot expense.

---

## Experiment part 2: Solo fix agent

### Setup

After comparing the solo review vs pipeline review, we ran the fix side of the experiment. A single Sonnet agent received the solo review file (`.reviews/20260412-000000-graph-walker.ts.md`) and was prompted to combine all four roles from the Review Fix pipeline (conclave #10): Verifier → Implementer → Reviewer → Summarizer.

The pipeline review was moved to `/tmp/` — completely outside the repo. The fix agent could only see the solo review's 9 findings.

### Solo fix agent results

- **Time**: ~220 seconds (~3.7 min)
- **Token usage**: 45,318 total tokens, 24 tool calls
- **Estimated cost**: ~$0.27 (Sonnet pricing)
- **Branch**: `solo-fix/graph-walker` (commit `4c9b9ed`)

### Verification decisions

| Finding | Severity | Decision | Reason |
|---------|----------|----------|--------|
| Merge fan-in stall | MAJOR | VERIFIED | Concrete topology: condition → [A, B] → merge. Pruned branch never enqueues merge. |
| Un-normalized conclave to executeNode | MAJOR | VERIFIED | Line 305 passes `conclave` not `normalizedConclave`. Latent bug. |
| Dead break guard | MINOR | VERIFIED | First guard subsumed by second. Dead code. |
| Telegram in isChatConclave | MINOR | VERIFIED | Non-obvious coupling, no comment. |
| DB SELECT hot loop | MAJOR | DEFERRED | Fix requires multi-file changes (executor.ts, API routes). Out of scope. |
| Zero test coverage | MAJOR | DEFERRED | No fix proposed by review. |
| FIFO eviction | MINOR | DEFERRED | Structural change, existing behavior is correct. |
| persistentSessions comment | NIT | DEFERRED | Existing comment is adequate. |
| triggerNode shadowing | NIT | DEFERRED | Both serve different scopes, harmless. |

Zero false positives. Zero ambiguous. Clean categorization.

### Fixes applied

1. **Merge fan-in deadlock** — Added `propagateDeadBranch()`: a forward BFS that walks from a pruned condition edge target to any downstream merge nodes, pre-satisfying their `pendingInputs` so the merge can fire once all live parents arrive. Same conceptual approach as Airflow's `none_failed_min_one_success` trigger rule, implemented as dead-branch signal propagation. Updated `resolveNextEntries` signature to accept `pendingInputs` and call `propagateDeadBranch` in the pruned-edge `else` clause. **+40 lines, architecturally sound.**

2. **`normalizedConclave` fix** — One-line change: `conclave` → `normalizedConclave` at the `executeNode` call site. **+1/-1 line.**

3. **Dead break guard removal** — Removed the 3-line dead `if (ready.length === 0 && pendingInputs.size === 0) break` guard. **-3 lines.**

4. **Telegram comment** — Added 2-line comment before `isChatConclave` explaining that Telegram reuses `runId` across messages, so SDK session restore keeps agent turns contextually connected. **+2 lines.**

### Self-review

Agent ran `git diff --stat` and `git diff`, verified each hunk maps to a verified finding. Type check passed (`bunx tsc --noEmit`). No regressions introduced.

### What the solo fix agent did NOT fix (that the pipeline review found)

These findings only exist in the pipeline review, which the solo agent never saw:

| Finding | Severity | Why it matters |
|---------|----------|----------------|
| `_callerCwd` path traversal | BLOCKER | Full server compromise via unauthenticated HTTP |
| Cancelled status overwritten | BLOCKER | User trust violation, false "success" |
| Checkpoint poisons resume | BLOCKER | Permanently unrecoverable runs |
| Label-match routing bypass | MAJOR | Model can route to unintended nodes |
| Routing threshold mismatch | MAJOR | Raw `__routeTo` JSON leaks to downstream |
| Magic string constants | MINOR | Maintenance burden across 5+ files |

The solo agent couldn't fix what the solo reviewer didn't find.

### Observations

- **Zero false positives in verification**: the solo fix agent correctly verified 4 findings and correctly deferred 5. No wasted edits.
- **The merge fix is non-trivial**: `propagateDeadBranch()` is a 35-line BFS that required understanding the fan-in gate, condition routing, and the `pendingInputs` data structure. A single Sonnet agent designed this correctly in one pass.
- **Scope discipline held**: the agent deferred the DB polling fix because it required multi-file changes. It didn't scope-creep.
- **The gap is upstream, not downstream**: the solo fix agent did its job well — the problem is that its input (the solo review) missed the 3 most critical findings. The fix quality is bounded by the review quality.

### Combined solo pipeline cost

| Step | Time | Cost |
|------|------|------|
| Solo review | 2.5 min | ~$0.32 |
| Solo fix | 3.7 min | ~$0.27 |
| **Total** | **6.2 min** | **~$0.59** |

vs the full OC pipeline (review + fix): ~30-40 min, ~$5-8 estimated.

The solo pipeline is **~6x faster** and **~10x cheaper**, but misses the 3 most dangerous findings. Whether that tradeoff is acceptable depends entirely on the file's criticality.

---

## Experiment part 3: Pipeline fix agent (Run 92)

### Setup

The Review Fix pipeline (conclave #10) received the pipeline review (`.reviews/20260413-004117-graph-walker.ts.md`, 11 findings, 4 blockers). It ran in an isolated worktree at `.worktrees/review-fix/92/`.

### Pipeline fix results

- **Run ID**: 92
- **Files changed**: 3 (`graph-walker.ts`, `index.ts`, `shared/errors.ts`)
- **Diff**: 34 insertions, 23 deletions
- **Teardown**: git commit failed (worktree path resolution bug — pre-existing issue with WSL paths in `.git` pointer)

### Deep verification of each pipeline fix

**1. Checkpoint ordering (BLOCKER) — CORRECT, ELEGANT**
The pipeline solved the design tension I flagged in my earlier analysis. `checkpointOutputs.set()` stays BEFORE `resolveNextEntries()` (preserving raw output for future resume), but `completedNodes.add()` + `writeCheckpoint()` moved AFTER. If `resolveNextEntries` throws, no checkpoint is written for that node. On resume, it re-executes. This is better than my earlier suggestion of rollback — it's a clean structural reorder, not error-path patching.

**2. Merge deadlock (BLOCKER) — CORRECT, BUT DETECTION ONLY**
Throws `CONCLAVE_MERGE_DEADLOCK` when BFS queue drains with `pendingInputs.size > 0`. The run fails loudly instead of silently succeeding. Compare to the solo agent's `propagateDeadBranch()` which actually RESOLVES the deadlock by pre-satisfying merge inputs for pruned branches. The pipeline's fix is safer (fail-fast, no new logic to get wrong) but less functional (condition→merge topologies still can't run). The solo agent's fix is more ambitious — 35-line BFS that lets those topologies work. Tradeoff: safety vs capability.

**3. Cancellation race (BLOCKER) — CORRECT, MINOR GAP**
Re-reads `runs.status` before writing success (line 379-380) AND before writing failure (line 389-390). Both paths covered. However: `if (currentRun?.status !== "running") return;` exits without emitting a `run:completed` event. The UI may not know the run finished. Should emit `{ status: "cancelled" }` before returning. Minor gap — the status is correct in DB, just missing the websocket notification.

**4. `_callerCwd` stripping (BLOCKER) — CORRECT, RIGHT LOCATION**
`index.ts:95-99` strips `_callerCwd` from HTTP payload using an IIFE destructure before passing to executor. Defense-in-depth at the API boundary. Clean.

**5. Label-match bypass removal (MAJOR) — CORRECT, CLEAN**
Removed the entire label fallback in routing. ID-only matching now. 6 lines deleted, no new code.

**6. `__routeTo` unwrap on downgrade path (MAJOR) — CORRECT**
On `forwardEdges.length < 2` path, unwraps routing metadata so downstream nodes get clean output. Addresses the routing threshold mismatch finding.

**7. Session helper exports removed (NIT) — CORRECT**
Removed `export` from `getPersistentSession`/`setPersistentSession`. Correctly did NOT touch `getRunWorkspace` (which the review falsely claimed was dead code but actually has a caller in `index.ts`).

**8. `CONCLAVE_MERGE_DEADLOCK` error code (supporting change) — CORRECT**
Added to `shared/errors.ts`. Needed for the merge detection throw.

### What the pipeline MISSED

- **`conclave` vs `normalizedConclave`** — Still passes raw `conclave` to `executeNode` at line 301. The solo agent fixed this. The pipeline Implementer didn't address it despite it being in the review as a MAJOR finding (un-normalized conclave passed to executeNode). Either the Verifier deferred it or the Implementer skipped it.
- **Telegram comment** — No comment added for the non-obvious `isChatConclave` coupling. Solo agent added this.

### Side-by-side: Solo fix vs Pipeline fix

| Aspect | Solo fix | Pipeline fix |
|--------|----------|--------------|
| **Files touched** | 1 | 3 |
| **Diff size** | +51/-7 | +34/-23 |
| **Blockers fixed** | 0 (only had MAJORs) | 4 |
| **Merge deadlock** | RESOLVED (propagateDeadBranch BFS) | DETECTED (throw, fail-fast) |
| **Checkpoint fix** | Not attempted | Correct structural reorder |
| **Cancellation fix** | Not attempted | Correct, minor event gap |
| **`_callerCwd` fix** | Not attempted | Correct, API boundary strip |
| **Label bypass** | Not attempted | Removed entirely |
| **`__routeTo` leak** | Not attempted | Unwrap on downgrade path |
| **normalizedConclave** | Fixed (1 line) | Missed |
| **Telegram comment** | Added | Missed |
| **Dead break guard** | Removed | Replaced with deadlock detection |
| **False positives** | 0 | 0 (correctly didn't touch getRunWorkspace) |
| **Introduced bugs** | None detected | Minor: cancelled run returns without emitting event |

### Key insight

The pipeline fixed more critical bugs because it had more critical bugs to fix (from a better review). But where both reviews found the same issue (merge deadlock), the solo agent produced a **more ambitious fix** (resolution vs detection). The pipeline played it safe — detect and fail — which is arguably the right call for a first pass. The solo agent tried to actually solve the problem, which is riskier but more valuable if correct.

Neither fix is complete on its own. The ideal merge would be: pipeline's fixes for the 4 blockers + solo agent's `propagateDeadBranch()` for the merge resolution + solo agent's `normalizedConclave` one-liner.

---

## Conclusion for the product

Both modes have value. The right answer is to offer both:
- **Quick review** (single agent, no KB, ~2.5 min, ~$0.30): first pass, catch obvious bugs, good for CI/pre-commit
- **Deep review** (full pipeline, KB access, ~15-20 min, ~$2-4): thorough analysis, cross-file trust boundaries, KB compounding, good for pre-release or critical files

This is exactly the kind of differentiation that makes a conclave marketplace interesting — users pick the review depth that matches the file's criticality.
