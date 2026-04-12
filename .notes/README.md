# Lab Journal

Running log of what we built, what we tried, what failed, and what we learned while taking OpenConclave's code review pipeline from idea to shipped-and-dogfooded in a single session.

**Session date**: 2026-04-11 → 2026-04-12 (UTC)

## Context: where we started

The project already had one working conclave — the **Tech Task Pipeline** (`oc_devteam`, conclave 5). It takes a free-text task description, creates an isolated git worktree, and runs a sequential Analyst → Test Engineer → Implementer → Test Runner → Reviewer → Summarizer flow. It exists to delegate bug-fix and small-feature work from a Claude Code session into a supervised autonomous workflow. It works, but it's a single monolithic pipeline.

This session set out to answer two questions:

1. **Can we build a code review conclave that compounds knowledge across runs?**
2. **Is that review conclave actually useful outside the OC dev context?**

Spoiler: yes to both, with caveats documented in the individual entries.

## Timeline

| # | Entry | Conclaves | Outcome |
|---|---|---|---|
| 01 | [Building the Code Review conclave](01-code-review-conclave.md) | 9 (Code Review) | Pipeline built; runs 44 + 45 captured 19 findings across runtime.ts + llm-call.ts; 12 real bugs fixed by hand |
| 02 | [Re-review verification](02-re-review-verification.md) | 9 (runs 46 + 47) | Write-back loop confirmed; discovered CVE-class SSRF bypass in my own fix |
| 03 | [Review Fix conclave and the issue #30 saga](03-review-fix-and-issue-30.md) | 10 (Review Fix), 11 (CWD Test) | Run 48 exposed a filesystem-escape bug; investigation via 5 isolation tests localized it to the CLI subprocess |
| 04 | [Fixing issue #30 via in-process MCP tools](04-issue-30-fix.md) | 10 (Review Fix, runs 58 + 59) | `mcp__oc__*` in-process filesystem tools replace broken CLI builtins; both review-fix runs clean |
| 05 | [v1.0.9 release + dogfood](05-v1.0.9-and-dogfood.md) | 9 (run 60), 10 | Version bumped, binaries published; fresh review on code.ts caught more bugs |
| 06 | [Summarizer grounding + KB Audit](06-summarizer-and-kb-audit.md) | 13 (KB Audit), 9 (run 61) | Summarizer prompt grounded in `git diff --stat`; heavy dogfood on discussion.ts; audit surfaces cross-file drift |

## Key numbers

- **6 conclaves** touched or created in a single session
- **~11 runs** of code review / review fix / KB audit combined
- **21 KB lessons** captured to KB 1 (the Dev Book) across the session
- **~20 real bugs** fixed in the codebase, from nits to blockers
- **1 architectural bug fixed**: issue #30, the worktree cwd escape
- **v1.0.9 shipped** to GitHub with 3 non-mac binaries

## What worked

- **The KB write-back loop compounds.** Later reviews cited earlier-captured lessons as `[KB hit]`. This is the part that no single-LLM tool can replicate: durable, searchable, project-specific knowledge that grows every run.
- **In-process SDK MCP tools are the right level of abstraction for workspace filesystem ops.** Moving Read/Write/Edit/Grep/Glob out of the Claude Code CLI subprocess and into OC's in-process MCP server eliminated a whole class of path-resolution bugs and gave us an explicit boundary we can audit.
- **The Bookkeeper is a cheap cross-codebase drift detector**, not just a KB hygiene tool. It found tech debt in four sibling files the per-file review pipeline had never visited.
- **Honest severity calibration held up across runs.** Two independent specialists flagging the same thing is higher confidence than one agent's opinion; the Lead Reviewer dedup'd correctly in every run.

## What must be improved

- **Summarizer hallucination class.** In multiple runs the Summarizer in `oc_review_fix` reported "1 fix applied" when 9 actually landed. Partially mitigated this session with a `git diff --stat`-grounded prompt; the fix still needs a verifying run.
- **Scope creep from Implementer.** Without explicit channel-loop guidance, the Implementer applies every verified finding including minors marked "defer". Needs prompt-level discipline.
- **KB audit doesn't scale.** Run 62 produced 103 events over 30 minutes on 18 documents. Bookkeeper v2 design (incremental audit keyed by commit hash, using a dedicated "Bookkeeper Journal" KB as self-notes) is sketched in entry 06 but not built.
- **Review pipeline coverage is uneven.** Four sibling files (`ollama-routing.ts`, `openai-routing-tools.ts`, `openai-chat.ts`, `openai-responses.ts`) never got reviewed and accumulated drift from their reviewed siblings. The Bookkeeper caught it. The real fix is systematic coverage, not whichever file is currently interesting.
- **Session-long KB audits are inherently retrospective.** By the time the Bookkeeper runs, the KB already has stale entries. A streaming audit (run after every Best Practices write-back) would catch noise sooner.

## Files in this folder

- `README.md` — this table of contents
- `01-code-review-conclave.md` — design and first runs of `oc_review`
- `02-re-review-verification.md` — runs 46 + 47, compounding knowledge, the SSRF bypass I introduced
- `03-review-fix-and-issue-30.md` — designing `oc_review_fix`, the worktree escape bug
- `04-issue-30-fix.md` — in-process `mcp__oc__*` tools, verification runs 58 + 59
- `05-v1.0.9-and-dogfood.md` — release and code.ts review (run 60)
- `06-summarizer-and-kb-audit.md` — prompt grounding, discussion.ts review (run 61), KB Audit (conclave 13, run 62)

## Related artifacts

- **Architecture design doc**: `../docs/conclave-composition.md` — the atomic-conclaves vision that emerged mid-session
- **Reviews produced**: `../.reviews/` — 4 review files from this session's `oc_review` runs
- **Commits**: `git log` from `b6ccbc8` onward on `rc/1.0.9` — all of this session's work
