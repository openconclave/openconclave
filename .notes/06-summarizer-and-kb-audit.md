# 06 — Summarizer grounding, discussion.ts review, and the KB Audit

**Conclaves**: 10 "Review Fix" (prompt update), 9 "Code Review" (run 61), 13 "KB Audit" (new — run 62)
**Runs this entry covers**: 61, 62
**Commits from this arc**: none from this arc itself — all work is pending apply after run 62's recommendations

## Objective

Three things from the session-end retro:

1. **Fix 1**: kill the Summarizer hallucination class. In runs 48 / 55 / 58 / 59 the Summarizer reported "1 fix applied" when 9 or more had landed in the worktree. It was reading the Implementer's markdown claims and paraphrasing, not checking the actual diff.

2. **Fix 2**: one more dogfood cycle on a heavy file to stress the pipeline. Something unreviewed with a nontrivial diff. `packages/server/src/engine/nodes/discussion.ts` (455 lines, multi-agent moderator, domain-specific).

3. **Fix 3**: build the Bookkeeper — a KB hygiene conclave that audits existing lessons against current code reality and flags stale / contradicted / malformed / duplicate entries. The question this answers: are the ~18 lessons we've captured this session actually all correct, or is some of it noise that'll poison future reviews?

## Fix 1 — Summarizer grounding

`update_node` on conclave 10's `summarizer` node. New prompt instructs:

```
FIRST, run `git diff --stat HEAD` via Bash. Copy the EXACT output.
This is ground truth.

The "Fixes applied" list MUST EXACTLY match the files that appeared
in `git diff --stat HEAD`. If a file is not in that diff, it did not
change — do NOT list it. If a file IS in the diff, you must list it.

Never list a file in "Fixes applied" that is not in `git diff --stat HEAD`
output. This is the single rule that matters.

When the diff is empty: "No files changed in this run." Do not make up fixes.
```

Single-line change in effect — grounding the report in a command output instead of the Implementer's freeform claims. Cost: zero. Requires an `oc_review_fix` dogfood run to verify it sticks, which hasn't happened yet in this session.

## Fix 2 — Run 61 on discussion.ts

**Result**: 0 blockers, 4 major, 4 minor, 3 nits — 11 findings on 455 lines. Review file: `.reviews/20260412-023439-discussion.ts.md`.

Severity calibration was **honest**: no blockers because the file has no current crash paths, only classes of failure under heavy input. That's correct — not everything is a blocker, and calling too many things blockers destroys the signal.

The 4 majors:

1. **Unbounded `JSON.stringify(input)` in the agent moderator prompt** — on Claude Sonnet 3.7+, exceeding the context window returns a **hard validation error**, not silent truncation. Any large non-string input is a guaranteed run-terminator.

2. **Code moderator catch block swallows all errors silently** — `runCodeModerator` returns `{ action: "call_next" }` with no event emission. Any failure is invisible to operators; the discussion runs to `maxRounds` with a broken moderator. No `node:failed` path.

3. **`responses` array and `input` both unbounded to code moderator stdin** — transcript is capped at 100KB, but `responses` isn't. In a 100-round discussion with verbose agents, `responses` dwarfs the capped transcript.

4. **Zero test coverage** — no tests for `executeDiscussion`, `runCodeModerator`, or `runAgentModerator`. The silent-error-swallow path is especially unverifiable.

The sharpest minor: **`executeAgent` receives full `edges` / `nodeMap`** (line 202). Participant agents auto-derive `routeTargets` from those edges; on the Ollama path the threshold is `length >= 1`, meaning any Ollama participant in a non-trivial graph receives routing instructions for conclave nodes *outside the discussion*. This can corrupt the participant's system prompt and cause mid-discussion routing attempts. Cross-file concern that a per-file specialist could easily miss.

**Best Practices wrote 3 new lessons** and cited 3 existing as `[KB hit]`. Compounding.

## Fix 3 — KB Audit conclave (13)

Created conclave 13 "KB Audit" via `create_conclave` (using the oc-dev MCP plugin — per the feedback memory to not build conclaves via scripts). 4 nodes:

- Trigger (manual, input: KB ID)
- Bookkeeper (Sonnet + KB 1 + Read/Grep/Glob/Bash) — fetches every document in the target KB via HTTP API, audits each against current code reality, channel-loops for non-valid entries
- Ask User (channel loop, connected to Bookkeeper right handle)
- Output

Bookkeeper system prompt enforces **"report, don't modify"**: the Bookkeeper finds drift, recommends edits, and asks for user confirmation. Actual KB edits are a follow-up step the user applies.

Audit checks:
1. Cited file paths / function names / symbols still exist in the repo
2. Cited library APIs still match current usage
3. Recent commits don't explicitly contradict the lesson
4. Lesson has structure (Why + How to apply + Source)
5. Not a duplicate of an earlier lesson in the same audit

## Run 62 — First KB audit

Triggered conclave 13 against KB 1 (the Dev Book — 18 documents at audit time).

**Result**: 15 valid / 2 stale / 1 contradicted-and-narrowed / 0 malformed / 0 duplicate.

The three non-valid:

1. **`lesson-zod-max-agent-tool-inputs.md` — stale.** The "Why" section cited `top_k: z.number().optional()` and `content: z.string()` as exploitable. Current code has `.int().min(1).max(100)` and `.max(500_000)` — the fix landed in commit `830b7da`. Action: update lesson to a before/after pattern (preserves the teaching value, corrects the stale example).

2. **`lesson-import-canonical-types-no-local-forks.md` — stale (but bigger).** The lesson cited `runtime.ts`'s old RouteTarget fork, which was fixed in `830b7da`. **But the Bookkeeper grepped and found the same pattern still live in two other files**: `ollama-routing.ts:3` and `openai-routing-tools.ts:3`. Same forked type, still missing the `description?: string` field. These are files the review pipeline never visited this session.

3. **`lesson-no-tool-nudging-descriptions.md` — contradicted (needs narrowing).** The lesson said "remove all `MUST call` imperatives from tool descriptions AND system prompts AND user prompts". Current code in `agent-executor.ts:190, 197` still injects "you MUST call `openconclave_next` to exit" into the Claude system prompt. The catch: the routing tool is a **terminal/structural tool** — the run hangs if the agent doesn't call it. The imperative is the exit contract, not advisory nudging. Resolution: narrow the lesson to distinguish tool descriptions (no imperative, ever) from system-prompt exit contracts (imperative permitted for structural tools). Meta-finding: **the lesson was missing its own nuance**, caught by the audit.

## Meta-finding the audit surfaced

**Three separate lessons applied fixes to one file but not to sibling files.** Full list:

| Lesson | Fixed in | Still broken in |
|--------|----------|-----------------|
| `lesson-import-canonical-types-no-local-forks` | runtime.ts | ollama-routing.ts, openai-routing-tools.ts |
| `lesson-no-tool-nudging-descriptions` | runtime.ts (tool desc) | ollama-routing.ts, openai-routing-tools.ts |
| `lesson-openai-tool-call-json-parse-guard` | llm-call.ts | openai-chat.ts, openai-responses.ts |

**Four sibling files never got reviewed this session and have inherited bug classes.** This is the *primary systemic finding of the audit*: lessons captured from one file apply to structurally similar files that were not reviewed. Per-file review misses this kind of drift; the Bookkeeper catches it.

## Total pending work from the audit

**KB edits (3, editorial — apply by hand or via HTTP API)**:
- Update `lesson-zod-max-agent-tool-inputs` with before/after
- Update `lesson-import-canonical-types-no-local-forks` to cite ollama-routing.ts / openai-routing-tools.ts as the current offenders
- Narrow `lesson-no-tool-nudging-descriptions` to carve out terminal/structural tools

**Code fixes (7, across 5 files)**:
- `ollama-routing.ts` + `openai-routing-tools.ts`: import `RouteTarget` from `engine/types`; remove "You MUST call" nudging from routing tool descriptions
- `openai-chat.ts` + `openai-responses.ts`: wrap `JSON.parse(toolCall.function.arguments)` in try/catch with tool name
- `discussion.ts:332-335`: emit `discussion:moderator_error` event in `runCodeModerator` catch before returning the fallback

**None of this has been applied in this session yet** — the Bookkeeper is report-only, and the fixes are a planned follow-up.

## What wasn't great

- **Full-scan audit doesn't scale.** Run 62 produced ~103 events over ~30 minutes on 18 documents. The Bookkeeper checks every cited path in every lesson against the whole repo every run. At even 100 documents this would be prohibitive.
- **Bookkeeper v2 design was discussed but not built.** The user proposed a cleaner model: give the Bookkeeper its own KB (say, KB 2 "Bookkeeper Journal") where it writes per-run audit entries with the commit hash and list of audited docs. Next audit does `git diff --name-only <last_head>..HEAD`, filters to lessons whose cited files appear in the diff, and only re-audits those. Lessons whose cited files haven't changed since the last audit are "inherited from <prior_audit_id>". Full re-audit becomes a forced flag.
- **Run 61's review already cited `[KB hit]` on one of the stale lessons** — meaning the specialists trusted a stale lesson when forming their findings. The drift isn't a dormant risk; it's already affecting review quality in subtle ways. Fixing this loop is more valuable than I initially framed it.

## Observations

- **The Bookkeeper earns its name.** Not just KB hygiene — a cross-codebase drift detector. Run 62 found code fixes the per-file review pipeline had not caught across ~7 prior review runs.
- **Best Practices' KB writes were uniformly high quality this session.** 19 lessons captured, 15 valid without any changes needed, 3 stale because the code evolved, 0 hallucinated or wrong. The write-back prompt discipline held.
- **One invariant emerged**: when a lesson captures a fixed bug, the lesson should show *both* the bug and the fix. "Before and after" is more valuable than either alone — it gives future readers the pattern to apply, not just the pattern to avoid.

## Conclusions

All three retro fixes landed. Fix 1 (Summarizer grounding) is in place but unverified. Fix 2 (heavy dogfood) produced a clean review with 11 legitimate findings. Fix 3 (Bookkeeper) built, ran, and surfaced more actionable work than any individual review in this session — not just for KB hygiene but for actual code fixes.

**The question the session opened with ("is this a compelling 'why OC'?") is answered.** The KB + per-file review + Bookkeeper triangle is a product story no single-LLM tool can replicate. Specific, demonstrable, and uniquely valuable for teams with nontrivial codebases and painful lessons worth institutionalizing.

## What must be improved (and what's next)

1. **Apply the 3 KB lesson updates and 7 code fixes from run 62.** This closes the loop on the audit.
2. **Build Bookkeeper v2** with the incremental audit + journal KB design. Makes audits cheap, enables running them often.
3. **Verify the Summarizer grounding fix** with an `oc_review_fix` run on the discussion.ts review. That's the natural follow-up dogfood.
4. **Review the 4 sibling files** (`ollama-routing.ts`, `openai-routing-tools.ts`, `openai-chat.ts`, `openai-responses.ts`) so they stop accumulating drift.
5. **Per-agent personal books** — the design doc sketches these as a replacement for Claude Code's memory + RAG. Would let each specialist accumulate role-specific lessons independently of the shared Dev Book.
6. **Summarizer prompt audit across all conclaves.** The hallucination class affects `oc_devteam` too, not just `oc_review_fix`. Same fix everywhere.

Session ends here. Journal files live in `.notes/`.
