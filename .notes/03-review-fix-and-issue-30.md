# 03 — Review Fix conclave, and the issue #30 saga begins

**Conclaves**: 10 "Review Fix" (`oc_review_fix`), 11 "CWD Test" (diagnostic)
**Runs this entry covers**: 48, 50–55
**No permanent code commits** — just diagnosis and reversion of two escape runs

## Objective

Build a companion to `oc_review`: a conclave that reads a review markdown file and **skeptically** applies the fixes. The key word is skeptically — a `[BLOCKER]` tag in a review is a *proposal*, not an instruction. The Fixer verifies each finding against current code, rejects false positives, and escalates ambiguity to the user before touching anything.

## Design

Running in parallel with conclave 5 (Tech Task Pipeline), conclave 10 uses:

- **Setup Worktree** (Python code node) — creates `.worktrees/review-fix/:runId`, copies `.reviews/` into it (gitignored files don't come with `git worktree add`), switches workspace cwd
- **Verifier** (Sonnet + KB + Read/Grep/Glob/Bash + Ask User channel loop) — parses the review, opens each cited location, reproduces the failure mode, categorizes `VERIFIED` / `FALSE_POSITIVE` / `AMBIGUOUS`
- **Implementer** (Sonnet + KB + Write/Edit + Ask User channel loop) — applies the verified findings, self-checks with `bunx tsc`
- **Reviewer** (Sonnet + KB) — diff-checks the Implementer's work, VERDICT:APPROVED / VERDICT:CHANGES_NEEDED with a retry loop
- **Summarizer** (Haiku) — final report
- **Teardown** (Python) — git commit in the worktree

Hard rules baked into prompts: Implementer cannot write new files; cannot touch files not cited in verified findings; cannot escalate scope beyond CLAUDE.md's "bug fix doesn't need surrounding cleanup" rule.

## Run 48 — first run on `.reviews/20260411-211515-llm-call.ts.md`

The Verifier and Implementer ran. The channel loop fired twice (good — I answered both questions with concrete design guidance). The Teardown committed. The Summarizer wrote a confident-sounding report.

Then I checked the main repo:

```
M packages/server/src/agent/llm-call.ts
?? packages/server/src/agent/llm-call.test.ts
```

**The Implementer's file writes had landed in the main tree, not the worktree.** The worktree was empty (`git status --short` returned nothing inside `.worktrees/review-fix/48`). Seventy lines of edits to `llm-call.ts` plus a brand-new 42-line test file — all in the main repo, while the isolated worktree sat unused.

This is **issue #30** (already filed earlier in the project): "Worktree cwd isolation bug: some agents respect the updated workspace cwd, others don't. Bash in Test Runner works; Write/Edit in Implementer don't."

The summary said "fixes applied" and listed changes that — by coincidence — happened to be things my earlier manual fix pass (`e754f27`) had already done. The stale review file from run 46 listed findings that were *already fixed*, and the Verifier/Summarizer chain failed to notice. The Implementer then hallucinated a fix report describing existing code state.

**I reverted everything in the main tree** and started diagnosing.

## The investigation (runs 50–54)

Built a minimal diagnostic conclave — conclave 11 "CWD Test" — with 3 nodes: trigger, setup (creates a worktree or a fresh clone depending on input), agent (writes test marker files, reports pwd / git-toplevel / find results), output.

Triggered it 5 times with increasing specificity:

| Run | Mode | Agent tool | Path depth | Result |
|-----|------|------------|------------|--------|
| 50 | worktree | Write | shallow (root) | correct, landed in worktree |
| 51 | clone | Write | shallow | correct, landed in clone |
| 52 | worktree | Write | 0, 1, 3 levels deep | all three landed in worktree |
| 53 | worktree | Edit on pre-existing tracked file | 3 levels deep | edit applied in worktree only |
| 54 | worktree | Glob + Read + Edit chain | 3 levels deep | edit applied in worktree only |

**Every isolated test worked.** I could not reproduce the escape with a single-agent conclave.

## Run 55 — reproducing the escape

Re-triggered `oc_review_fix` on the runtime.ts review. This time:

- Main tree `git status`: `M packages/server/src/agent/runtime.ts`, `M package.json`
- Worktree `.worktrees/review-fix/55` status: clean
- **Escape reproduced.** 70 insertions in main tree, zero in worktree.

The `package.json` change was an SDK bump from `0.2.91` to `>=0.2.92` — exactly the version range we pinned around because of the broken `tempfile.js` packaging bug. **The Implementer actively made things worse** and the Summarizer claimed everything was fine.

## Investigation conclusion

The CWD test runs (50–54) all worked because they used:
- Haiku, not Sonnet
- Single agent, no KB tools, no channel loops
- Short prompts

Run 48 and 55 (the escaped ones) used:
- Sonnet Implementer
- KB tools attached (the in-process `openconclave-conclave` MCP server)
- Multi-agent session chain (Verifier → Implementer → Reviewer)
- Long prompts

**Something in the "complex agent" shape triggers the escape.** Web-searching the Claude Code CLI source confirmed it has its own `.git`-walking project-root detection: inside a worktree whose `.git` is a file pointer back to the main repo, the CLI's walk can follow the pointer and decide the "real" project root is the main repo, then resolve Write/Edit paths against that root — despite the spawned subprocess's actual `cwd` being correctly set to the worktree.

Bash worked (Test Runner always ran correctly in the worktree) because Bash spawns shell commands with the subprocess cwd; Write/Edit are tools implemented *inside* the CLI that resolve paths with their own logic.

## Conclusions

Cannot fix this in the CLI — minified upstream bundle, not ours. Cannot fix it by switching worktree → clone alone — unverified whether Claude Code's `.git` walk would still escape. The real fix needs to **bypass the CLI's filesystem tools entirely** and route Read/Write/Edit through OC's in-process MCP server, which has no such path-resolution issues.

## Next

Entry 04: the in-process `mcp__oc__*` tools, and two clean review-fix runs validating the fix.
