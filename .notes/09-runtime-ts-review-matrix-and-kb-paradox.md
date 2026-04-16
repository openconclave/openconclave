# 09 — `runtime.ts` review matrix + the empty-KB paradox

**Date**: 2026-04-16
**File under review**: `packages/server/src/agent/runtime.ts` (737 lines) in `c:\Users\beine\source\repos\openconclave-copy` (pre-fix mirror)
**Goal**: Second datapoint after `web-fetch.ts` (journal 08) — compare solo Opus / Sonnet / Haiku vs Haiku-in-conclave, on a file whose KB coverage is thinner than `web-fetch.ts`.
**Bonus experiment**: rerun the conclave with KB 1 emptied to isolate how much of the conclave's output comes from KB grounding vs raw multi-agent reasoning.

## Prompt (identical across all five runs)

> Please do a thorough code review of packages/server/src/agent/runtime.ts in this repository.
>
> Look for bugs, security issues, race conditions, resource leaks, correctness problems, error-handling gaps, and any violations of the project's CLAUDE.md conventions. Cite specific line numbers. Rank findings by severity (blocker / major / minor / nit).

## Final matrix

| # | Config | Run | Findings | Cost | Wall time |
|---|---|---|---|---|---|
| 1 | Solo Claude Opus 4.6 | 147 | **1B / 7M / 20m / 10n** (38 total) | **$1.2514** | ~5 min |
| 2 | Solo Claude Sonnet 4.5 | 149 | **0B / 3M / 6m / 4n** (13 total, **+1 novel vs Opus**) | n/a (not measured) | ~3 min |
| 3 | Solo Claude Haiku 4.5 | 148 | **0B / 1M / 3m / 1n** (5 total) | **$0.1008** | ~2 min |
| 4 | Light Code Review conclave (Haiku ×4, KB populated) | 150 | **0B / 0M / 4m / 2n** (6 total) | **$0.633** | 10m 25s |
| 5 | Light Code Review conclave (Haiku ×4, **KB 1 empty**) | 151 | **3B / 4M / 4m / 2n** (13 total) | **$0.467** | 7m 25s |

Conclave #28 = `Light Code Review`: `Trigger → [Security, Correctness, Conventions] → findings_brief → Writer → Output`. All four agents on `claude/haiku`.

## Per-config headline findings

### 1) Solo Opus (run 147) — gold standard

- **B1**: `WebFetch` tool crashes with cryptic `TypeError` when caller omits `runId` (lines 166, 170, 248–259).
- **M1**: Env-var secret blocklist is incomplete — misses `AWS_ACCESS_KEY_ID`, `NPM_CONFIG__AUTH`, `SSH_AUTH_SOCK`, `KUBECONFIG`, `*_DSN`/`*_URI`/`*_PAT`. Should be an allowlist.
- **M2**: `ws = options.workspace ?? new Workspace()` (line 127) silently defaults to `process.cwd()` → re-opens issue #30.
- **M3**: `ask_user` has no timeout / abort wiring → 3 abandoned prompts deadlock the default AgentPool (3 slots).
- **M4**: `routeTargets.length >= 2` (line 292) inconsistent with Ollama/OpenAI engines which use `>= 1`.
- **M5**: `resolveCliPath` leaks tmp files on error and returns an unexecutable bunfs path instead of throwing.
- **M6**: `findSystemClaude` trusts `PATH` blindly — combined with `bypassPermissions`, supply-chain concern.
- **M7**: Module-level file I/O + `console.log` at import time (should be lazy, should use `logger`).

### 2) Solo Sonnet (run 149) — caught 1 novel finding Opus missed

- **M1** overlap: `AWS_ACCESS_KEY_ID` not blocked (regex misses `_ID` suffix).
- **M2** (novel, Opus missed): `/^mongo.?uri$/i` doesn't match `MONGODB_URI` (the standard Mongoose/Atlas env var) — `.?` matches 0 or 1 char, but `MONGO` → `URI` has 4 chars (`DB_`) between them. Test suite covers `MONGO_URI`, not `MONGODB_URI`, so the gap is invisible to CI.
- **M3** overlap: `ask_user` hangs without abort wiring.
- Missed: Opus B1 (WebFetch crash), M2 Workspace-default, M5 tmp leak, M6 supply chain.

### 3) Solo Haiku (run 148) — confident false approval

Found: 1 major (TOCTOU in `resolveCliPath`) + 3 minors (async generator cleanup, `_(key|token)$` regex edge cases, O(n) chunk lookup).

**Missed everything that mattered, and explicitly praised two of Opus's flagged issues as strengths**:
- "Excellent environment variable filtering to prevent secret exfiltration" ← Opus flagged this as **M1** (incomplete).
- "Proper workspace path isolation" ← Opus flagged this as **M2** (`new Workspace()` default re-opens issue #30).

Same pattern as journal 08's web-fetch result. Solo Haiku confidently signs off on live defects.

### 4) Haiku conclave with KB populated (run 150)

Found: 0B / 0M / 4 minors / 2 nits. Writer output **hallucinated "3 blocker" in the summary string** while the body correctly lists 0 blockers (Writer bug — needs a guard).

Real findings:
- `buildSubprocessEnv` `{ ...out, ...extra }` allows caller to reintroduce blocked env vars (Security, minor).
- Routing tool error format inconsistent with other tools (Correctness, minor).
- Comment on lines 165–172 violates CLAUDE.md (Conventions, minor).
- `INPUT_MAX_BYTES` measures chars not bytes (Conventions, minor).
- `knowledge_fetch` numeric params lack `.max()` bounds (Security, nit).
- Grammar error in comment (Conventions, nit).

Specialists cited KB lessons (`lesson-minimal-env-for-agent-subprocesses.md`, `lesson-zod-max-agent-tool-inputs.md`). Lessons were stale — they reference `llm-call.ts`, but `buildSubprocessEnv` has since moved to `runtime.ts`. The conclave matched the *concept* and still found the pattern.

### 5) Haiku conclave with KB 1 emptied (run 151) — the paradox

**More findings, lower cost, faster wall time.**

- **[blocker]** `WebFetch` crashes when called without `runId` (lines 301, 378–386) — **same issue Opus flagged as B1**. KB-grounded run missed it entirely.
- **[blocker]** `mkdirSync` with `recursive: true` only applies `mode: 0o700` to *newly-created* directories; reuses existing dir silently without permission check.
- **[blocker]** `JSON.stringify(input, null, 2)` at line 136 is unguarded — throws on circular references at a system boundary.
- **[major]** Missing permission verification after `mkdirSync`.
- **[major]** Input truncation has no caller-facing signal (agent sees `...[truncated]`, caller does not).
- Plus 4 minors, 2 nits covering similar convention / error-handling gaps.

**Comparing the two conclave runs side by side**:

| Dimension | Run 150 (with KB) | Run 151 (empty KB) |
|---|---|---|
| Findings | 6 | 13 |
| Blockers | 0 | 3 |
| Caught Opus B1 (WebFetch crash) | ❌ | ✅ |
| Cost | $0.63 | $0.47 |
| Wall time | 10m 25s | 7m 25s |

## The empty-KB paradox — what happened

My earlier hypothesis (end of journal 08): *"KB coverage gates the architectural win."* On `web-fetch.ts`, conclave-with-KB was dramatically better than solo Haiku because KB 1 had strong SSRF / Zod lessons directly applicable. On `runtime.ts`, I expected the conclave advantage to shrink because KB coverage of CLI-subprocess / SDK-routing territory is thinner.

What actually happened is different: **populated KB made the conclave *worse* on `runtime.ts`, not just less-better**. Emptying the KB produced strictly more findings, lower cost, and faster completion — and caught the single hardest bug in the file (Opus B1).

Candidate explanations (not disambiguated — one run each, n=1 for both conditions):

- **Anchoring**: with KB results in context, specialists may have steered toward confirming what they found in KB (env filtering, Zod bounds) and under-allocated attention to open reading of the file.
- **Token budget**: empty KB means no KB-search tool calls, no snippets consumed, so more effective budget for the file itself.
- **Survivorship in KB**: lessons that exist in KB 1 are the ones the team already knows and has written up. They describe solved / noticed patterns. Novel defects (like the WebFetch non-null assertion) don't match any lesson and therefore don't get surfaced by KB-guided search.
- **Sample variance**: n=1 each. Real.

All four could be contributing. What's clear: **KB grounding is not a free win**. The mechanism matters — a supervised-learning loop is a good thing, but feeding past lessons into a review specialist may anchor it at the cost of fresh reading.

## Cost / time comparison

| Config | Cost | Cost vs Opus |
|---|---|---|
| Solo Opus | $1.2514 | 1.00× |
| Solo Haiku | $0.1008 | 0.08× |
| Conclave with KB | $0.633 | 0.51× |
| Conclave empty KB | $0.467 | 0.37× |

Empty-KB conclave catches the Opus blocker at **37% of Opus's cost** — and is faster than the with-KB conclave by 3 minutes.

## What we can't claim (yet)

- That emptying KB is a *general* win. n=1 in each condition, on one file. Journal 08's `web-fetch.ts` conclave used a populated KB and performed very well — we don't have an empty-KB rerun of that one.
- That the with-KB conclave is *strictly worse*. Its 6 findings included 4 real issues (env passthrough, routing error format, byte-counting, `.max()` bounds) that the empty-KB run did not catch. Different configurations may see different subsets of the real defect set.
- That Haiku-in-conclave is ever comparable to solo Opus on the *blocker count*. Opus found 1B + 7M across both configs; conclave empty-KB found 3B + 2M (one of them = Opus B1). Overlap is partial, not subset.

## What we *can* claim

- **Solo Haiku false-approves real security defects**, and does it with confident language. Same finding as journal 08. Two-for-two.
- **Conclave-of-Haikus measurably outperforms solo Haiku** on the same file, same prompt, same model family — on blocker-class findings it matters most.
- **The KB grounding is not a free multiplier**. On this file it cost us the single hardest bug. Needs more runs to understand when KB helps vs. hurts.
- **Writer hallucinates its own summary** on Haiku. Both conclave runs summarized with inflated blocker counts that contradict their own bodies. Fixable but present. Worth a guard or a schema-validated summary node.

## Implications for positioning

Journal 08 closed with: *"Same Haiku. Same file. Solo: approves a live SSRF vulnerability. Conclave: catches it."* That still holds on `runtime.ts` — solo Haiku missed the WebFetch crash blocker and the Workspace escape; conclave-empty-KB caught the crash.

But journal 09 adds a harder, more honest claim:

> **A populated KB can actively reduce review quality on a given file.** The architectural win (multi-agent, adversarial specialist roles, structured consolidation) is robust; the knowledge-base layer on top of it is a knob that can cut both ways, depending on whether past lessons apply to the file under review.

For marketing: lead with the conclave-vs-solo comparison (reproducible, large effect). Treat the KB claim as "work in progress — we're learning when it helps".

## Follow-ups

1. **Rerun `web-fetch.ts` conclave with empty KB** → does the SSRF catch survive without KB anchoring, or was KB load-bearing there?
2. **Third and fourth runs of `runtime.ts` conclave, both conditions** → get past n=1 on the paradox.
3. **Fix the Writer hallucinated-summary bug**: either validate the summary string against the body counts at runtime, or make summary a Code-node computation from the structured findings JSON rather than a free-text Haiku synthesis.
4. **Ship the `runtime.ts` blockers** Opus and conclave-empty-KB found: WebFetch crash guard, Workspace default, `ask_user` abort wiring, env blocklist → allowlist, `resolveCliPath` tmp leak, `JSON.stringify` guard, `mkdirSync` permission verification.
