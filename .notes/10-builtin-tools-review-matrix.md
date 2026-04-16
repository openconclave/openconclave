# 10 — `builtin-tools.ts` review matrix

**Date**: 2026-04-16
**File under review**: `packages/server/src/agent/builtin-tools.ts` (≈540 lines) in the real repo (no mirror this time — openconclave-copy was deleted)
**Goal**: Third datapoint after `web-fetch.ts` (journal 08) and `runtime.ts` (journal 09). Run all four configs side by side and see which defects each surfaces on the agent tool surface that every Claude / Ollama / OpenAI conclave agent uses.
**KB state**: KB 1 was cleaned in the previous session (journal 09) and has not been repopulated. All runs here are empty-KB.

## Prompt (identical across all four runs)

> Please do a thorough code review of packages/server/src/agent/builtin-tools.ts in this repository.
>
> Look for bugs, security issues, race conditions, resource leaks, correctness problems, error-handling gaps, and any violations of the project's CLAUDE.md conventions. Cite specific line numbers. Rank findings by severity (blocker / major / minor / nit).

## Methodology note: AgentPool serialization

`MAX_CONCURRENT_AGENTS=1` was still set from earlier Ollama-debugging work. Combined with OC's singleton `AgentPool` at `packages/server/src/agent/pool.ts:103`, this means every `solo_*_chat` call and every conclave specialist competes for one global slot. All four runs were launched within 4 seconds of each other but queued through a single worker:

| Run | Started | Completed | Wall time |
|---|---|---|---|
| 154 Solo Opus | 05:16:24.553 | 05:20:18.875 | 3m 54s ✓ ran first |
| 155 Solo Sonnet | 05:16:26.055 | 05:25:48.575 | 9m 22s |
| 156 Solo Haiku | 05:16:27.612 | 05:28:26.686 | 11m 59s (queued behind 155) |
| 157 Light conclave (Haiku ×4) | 05:16:28.743 | 05:36:36.946 | 20m 8s (3 specialists queued one-at-a-time, then Writer) |

Haiku looking "slower" than Opus is a scheduling artifact, not model speed. For future matrix experiments, either raise `MAX_CONCURRENT_AGENTS` (default is 3; at least 6 needed to fully parallelize 4 solos + a 3-specialist conclave) or run them serially and accept the wall time.

## Final matrix

| # | Config | Run | Findings | Cost | Wall time |
|---|---|---|---|---|---|
| 1 | Solo Claude Opus 4.6 | 154 | **2B / 10M / 13m / 7n** (32 total) | **$0.7014** | 3m 54s |
| 2 | Solo Claude Sonnet 4.5 | 155 | **0B / 4M / 4m / 4n** (12 total) | **$0.6667** | 9m 22s |
| 3 | Solo Claude Haiku 4.5 | 156 | **0B / 3M / 4 m/nit** (7 total) | **$0.1458** | 11m 59s |
| 4 | Light conclave (Haiku ×4, empty KB) | 157 | **4B (1 false positive) / 1M / 5m / 0n** (10 total) | **$0.4935** | 20m 8s |

Conclave #28 cost breakdown: Security $0.1513 + Correctness $0.1388 + Conventions $0.1667 + Writer $0.0366 = **$0.4935**.

## Per-config headline findings

### 1) Solo Opus (run 154)

- **B1**: `bash` tool has no timeout, no output cap, no AbortController, and serialized stdout/stderr draining. Any `sleep 99999` pins the pool; `cat /dev/urandom | head -c 5G` OOMs the server; serialized draining can deadlock on large stderr.
- **B2**: `resolvePath` passes absolute paths through unchanged (`workspace.resolve` on an absolute path just `normalize()`s it). `read_file`, `write_file`, `edit`, `glob`, `grep` all accept `/etc/passwd`, `C:\Users\beine\.ssh\id_rsa`, the SQLite DB path. Combined with `ollama-tools.ts` calling `createBuiltinTools()` with *no* workspace, Ollama agents become fully unsandboxed. Docstrings on `write_file`/`edit` claim otherwise — that's a contract violation, not just a missing check.
- **M1–M10**: hardcoded `bash -c` on Windows; no argument type validation; `read_file`/`write_file`/`edit` have no size cap; `edit` is non-atomic; grep's path construction mixes separators on Windows; `TOOL_NAME_MAP`/tool-picker invariant has no runtime check; `knowledge_fetch` has no authorization scoping (any agent can read KB 2 "OCParther"); glob's break condition overshoots by one; `grep` regex has no ReDoS protection.
- **m1–m13, n1–n7**: inconsistent error logging (filesystem tools eat errors silently while KB tools log at `error`), `edit` no-op detection missing, dynamic imports inside hot paths, chunk numbering display confusion, etc.

### 2) Solo Sonnet (run 155)

Agrees with Opus on the bash trifecta (no timeout, no output cap, sequential drain) but ranks them **major** not blocker. Agrees on absolute-path escape but ranks it **minor** — same observation, different severity.

**Novel catch vs Opus**: `knowledge_fetch` / `knowledge_add` have **no KB-id authorization check in the Ollama/OpenAI execution path**. `runtime.ts` guards with `knowledgeBaseIds.includes(knowledge_base_id)`; `builtin-tools.ts` executors (used by `AgentBase` for non-Claude models) don't. An Ollama/OpenAI agent connected to KB 1 can fetch or write to any KB by passing its id. Verified the claim by inspection — `resolveKnowledgeTools` scopes the all-KB fallback but not explicit-id calls.

Missed vs Opus: M1 (Windows `bash -c`), M2 (arg type validation), M3/M4 (size caps), M8 (tool-picker invariant), M10 (KB 2 unauth from the Claude side).

### 3) Solo Haiku (run 156)

Found: path-traversal (cites `ollama-tools.ts` with no workspace — same as Opus B2 / Sonnet), bash no-timeout (partial), edit TOCTOU, grep path concat, Windows CRLF handling in line splits.

**Missed**: bash output cap + pipe deadlock (the other two thirds of Opus B1), grep ReDoS, knowledge_fetch unscoped access (both the Claude-side KB-2 leak and Sonnet's Ollama-side gap), tool-picker invariant, arg-type validation gap.

Same profile as prior Haiku solo runs: identifies real issues but misses depth. Does not confidently false-approve anything here — this file is shorter and has more obvious defects than `runtime.ts` did.

### 4) Light conclave (run 157, empty KB)

Writer summary on disk: *"4 blockers, 1 major, 5 minor findings."* Let's check each blocker.

- **[blocker] Path Traversal via absolute paths** — **real**, matches Opus B2 and Sonnet's minor (Sonnet got severity wrong).
- **[blocker] Bash Command Injection — Unvalidated Shell Commands** — **FALSE POSITIVE**. The bash tool is *designed* to execute agent-supplied commands. That's the whole point. The specialist misread the threat model (agents with `bypassPermissions` are trusted to run commands; the guards are around which agents get bash access, not around the bash tool itself). This is a hallucinated blocker.
- **[blocker] Secret Leakage via Uncontrolled Bash Environment** — **real, and novel vs Opus/Sonnet/Haiku-solo**. The `bash` tool at line 42–47 calls `Bun.spawn` with no `env` param, inheriting the full parent process environment including `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. Any bash-enabled agent can exfiltrate with `env | base64 | ...`. None of the solo runs caught this.
- **[blocker] Pipe Deadlock in Bash Tool** — **real**, matches Opus B1 / Sonnet M1. Specialist correctly cited the existing `engine/nodes/code.ts:70–75` pattern as the reference implementation.
- **[major] Regular Expression DoS in Grep** — real, matches Opus M9 / Sonnet minor.
- **[minor] Path construction, type casting, subprocess cleanup, glob cap constant, grep file-size constant** — all real, all minor-severity, subset of Opus's 13 minors.

Net: **3 real blockers + 1 false positive + 1 real major + 5 real minors = 10 findings, 9 valid**.

The conclave surfaced one blocker-class finding neither Opus nor Sonnet caught (bash env inheritance) at 70% of Opus's cost, but also produced a hallucinated blocker. Compared to running on `runtime.ts` (journal 09, run 151): similar shape — empty-KB conclave catches blockers solos miss, but the Writer still occasionally miscounts or inflates severity.

## Novel catches

| Finding | Opus | Sonnet | Haiku solo | Conclave (157) |
|---|---|---|---|---|
| Bash no timeout / output cap / pipe drain | ✅ (B1) | ✅ (3 majors) | partial | ✅ |
| `resolvePath` absolute-path escape | ✅ (B2, blocker) | ✅ (minor — severity miss) | ✅ (major) | ✅ (blocker) |
| `ollama-tools.ts` no-workspace call | ✅ | ✅ | ✅ | implicit |
| Arg type validation (LLM sends wrong type) | ✅ (M2) | — | — | ✅ (as minor) |
| Windows `bash -c` portability | ✅ (M1) | — | — | — |
| Grep ReDoS | ✅ (M9) | ✅ (M8) | — | ✅ (major) |
| Tool-picker invariant no runtime check | ✅ (M8) | — | — | — |
| `knowledge_fetch` unauth Claude-side (KB 2) | ✅ (M10) | — | — | — |
| `knowledge_fetch` unauth Ollama-side | — | ✅ ← **Sonnet novel** | — | — |
| Bash env inheritance leaks secrets | — | — | — | ✅ ← **conclave novel** |
| CRLF in line splits | — | — | ✅ | — |
| glob vs grep inconsistent defaults | ✅ | ✅ | — | — |

Two genuinely novel catches outside Opus's set — one each from Sonnet and the conclave. This is the composition advantage in raw form: different configurations see different slices of the real defect set.

## What needs to be fixed

Ranked by "real + cited by ≥2 reviewers" first:

### Blockers (all four converge)

1. **Bash no timeout / no output cap / no AbortSignal / sequential drain** (`bash` in `builtin-tools.ts:42–57`). Fix: wrap in `Promise.all([stdoutText, stderrText, proc.exited])`, add a timeout race that calls `proc.kill()`, cap stdout/stderr buffer size (~4 MB), and wire `abortController` through `createBuiltinTools`.
2. **Absolute paths bypass workspace sandbox** (`resolvePath` at `builtin-tools.ts:21`, `workspace.resolve`). Fix: after resolving, assert `resolved.startsWith(workspace.cwd)` or is in `getAllowedDirs()`; reject otherwise. Update `write_file`/`edit` docstrings to match actual behavior. Same class as issue #30 — high severity.
3. **Bash tool inherits full parent env** (conclave novel catch, lines 42–47). Fix: pass `env: buildSubprocessEnv({ ...minimal })` — same pattern already used by `runtime.ts` for the Claude CLI subprocess and by `engine/nodes/code.ts` for code nodes. This is **three for three** on subprocess surfaces that need the env allowlist.

### Majors worth doing in the same pass

4. **`ollama-tools.ts` calls `createBuiltinTools()` with no workspace** — trace back to the caller and require a workspace.
5. **Zod-validate tool arguments at the LLM boundary** — every `args.foo as string` is a latent TypeError when the model sends a number/object. System boundary per CLAUDE.md.
6. **Grep ReDoS guard** — either a regex-complexity heuristic or a worker-thread / `setTimeout` bailout after N ms.
7. **`knowledge_fetch` / `knowledge_add` KB-id scoping in `builtin-tools.ts`** — port the `knowledgeBaseIds.includes()` guard from `runtime.ts` into the AgentBase-side executors. (Sonnet's novel finding.)
8. **`TOOL_NAME_MAP` ↔ tool-picker invariant** — add a unit test that asserts every id in `tool-picker.tsx` has a matching entry + executor.
9. **`edit` atomicity** — per-path mutex or `writeFile(path, content, { flag: "wx" })` staging.

### Minors

Size caps on `read_file` / `write_file`, grep `max_results` clamp, glob break-before-push, consistent error-logging policy across filesystem and KB tools, cross-platform path construction via `path.join` in grep, `edit` no-op detection, dynamic imports lifted.

## Meta observations

1. **Empty-KB conclave held up on a second file**. Journal 09's surprise — that emptying KB 1 made the conclave produce *more* real blockers — repeats here. The conclave caught the bash env leak that no solo model did, and still came in at 70% of Opus's cost. Not a one-run fluke.
2. **Writer summary is still lightly unreliable.** Run 157 Writer summary said "4 blockers" without flagging that one of them was the bash-command-injection false positive. The conclave-layer fix (schema-validated summary from structured findings JSON, or a second-pass critic) is the same one we identified in journal 09 and has not shipped yet.
3. **Pool capacity is now an experiment-methodology concern.** With `MAX_CONCURRENT_AGENTS=1`, running the 4-way matrix cost ~20 minutes of wall time that could have been under 4 minutes. Needs either documentation (there's no README reference — only `pool.ts:104`), a bigger default, or both.

## Writer audit — what the consolidation step actually did

The four artifacts the conclave produced before consolidation are at `~/.openconclave/sessions/157/artifacts/`:

- `SECURITY_REVIEW_builtin-tools.md` (323 lines, Security specialist)
- `FINDINGS_builtin-tools.md` (204 lines, Security — second pass / summary)
- `builtin-tools-code-review.md` (74 lines, Correctness specialist)
- `builtin-tools-review.md` (58 lines, Conventions specialist)

Compared against the final `.reviews/20260416-053603-builtin-tools.ts.md` the Writer produced, the Writer was actually pretty faithful:

- All 10 findings from specialists survived into the final review.
- Severities preserved.
- Attribution preserved.
- Reasonable dedup (ReDoS-and-grep-timeout merged; bash-env-as-both-blocker-and-major collapsed to the blocker).

**What the Writer did NOT do**: flag contradictions between specialists. There were two.

### Specialist error 1 — Security misread the threat model

The Security specialist flagged *"Bash Command Injection — Unvalidated Shell Commands"* as a BLOCKER, reasoning that `args.command` passes directly to `bash -c` without validation. This is correct as a description of the code, but a misread of the threat model: the bash tool is *designed* to execute agent-supplied commands for trusted agents running under `bypassPermissions`. Security then recommended *"Disable bash tool in production"* — which would break the product.

The Writer passed this finding through without critique.

### Specialist error 2 — Conventions hallucinated a clean bill of health on the same surface Security flagged

In the same run, at the same time, Conventions wrote (`builtin-tools-review.md:32`, `:48`):

> *"Workspace path resolution: All filesystem operations use `resolvePath()` to constrain paths to the workspace when available. Prevents path traversal and escape."*
>
> *"No security issues: bash tool is intentional; workspace.resolve constrains paths; env secrets filtered in runtime.ts."*

All three clauses in the second sentence are factually wrong for this file (`workspace.resolve` does *not* constrain absolute paths; env secrets are *not* filtered for the bash subprocess — they're filtered only for the Claude CLI subprocess in `runtime.ts`; "bash tool is intentional" is the thing Security got wrong, not the thing Security got right).

Security and Conventions were **looking at the same file in the same run and drawing opposite conclusions**. Writer accepted Security's version silently. Correct answer, but arrived at by luck rather than by the Writer doing a critic pass.

### Specialist error 3 — Correctness overclaimed outside its role

Correctness ended with *"No security vulnerabilities or resource leaks. Tool definitions are well-structured and error handling is comprehensive."* Its actual review only covered the bash pipe deadlock (valid, important). The rest of the "no security vulnerabilities" claim is outside Correctness's mandate and contradicts Security's findings in the same run.

### The Writer-layer bug, stated precisely

The Writer's current contract is *"consolidate the three specialist reviews into a single markdown document, dedupe, sort by severity, attribute to specialists"*. That's what it did. What it did **not** do is **cross-check specialists against each other**. If Specialist A says "this is a blocker at line N" and Specialist B says "this surface is safe" in the same run, the Writer should flag it rather than silently pick a side.

Concrete proposals:

1. **Add a critic pass**: after consolidation, a second agent (or a second Writer turn) reads the specialist outputs AND the consolidated review, and emits a "contradictions" section. Costs one extra agent call (~$0.05 at Haiku pricing).
2. **Require specialists to cite line numbers**. Security cited them; Conventions made generic claims without line numbers. When two findings about the same file lack overlapping citations, Writer can't detect contradiction. Add a schema constraint.
3. **Specialist self-check**: "Before you claim 'no security issues', would you bet your job on it?" prompt addition to Conventions and Correctness. They're over-claiming outside their role because the system prompt invites them to.

Journal 09's Writer-summary-count hallucination and journal 10's specialist-contradiction-blindness are **the same class of bug** — the conclave has no meta-layer that audits its own output before emitting it. Worth prioritizing.

## Follow-ups

1. **Ship the three bash-tool blockers** (timeout/drain/abort, env allowlist, path sandbox enforcement). Touches `builtin-tools.ts` and probably `workspace.resolve` / `ollama-tools.ts`. Affects every agent using any OC tool.
2. **Add a critic pass to conclave #28** (or replace the Writer with one that runs a contradiction check). Journal 09 found Writer inflating blocker counts; journal 10 found Writer passing through one specialist's confident hallucination that directly contradicted another specialist's blocker in the same run. This is now a two-datapoint conclave-layer defect.
3. **Tighten specialist system prompts** so Correctness and Conventions don't make sweeping "no security issues" claims outside their role.
4. **Document `MAX_CONCURRENT_AGENTS`** (and related env vars) in the README or a new `docs/configuration.md`.
5. **Consider a follow-up experiment**: re-run journal 10 with `MAX_CONCURRENT_AGENTS=6` and a populated KB 1, after KB is seeded with lessons extracted from journal 08/09/10 findings. Tests whether the empty-KB paradox is a "KB was stale" effect or a "KB anchors specialists" effect.
