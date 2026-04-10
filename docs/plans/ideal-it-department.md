# Ideal IT Department for OpenConclave Development

A design plan for a new OpenConclave workflow (provisional name: **Tech Task Pipeline**) that turns Claude Code from a task executor into a task *delegator*. When a developer hands the pipeline a technical task, the pipeline's agents behave like a small in-house engineering team — they analyze, research, ask clarifying questions, write tests, implement, verify, review, and report back.

This document is the plan *before* any nodes get built. Read it, edit it, push back, and once we agree on shape I'll create the workflow.

## The goal in one sentence

Replace "Claude Code does the work while talking to the user" with "Claude Code hands the work to a team of specialized agents and acts as the client, approving and clarifying as needed."

## Why a new workflow

Workflow 14 (Dev Pipeline) is a great reference but wrong for this job: it runs two parallel server/client tracks with seven agents each, no human-in-the-loop, and it's scoped to generic feature development. It's too big and too silent.

Workflow 28 (CodeReview) is the closest living ancestor — isolated worktree, three parallel reviewers using different engines for independent perspectives, synthesis, RED tests, interactive bug fix. Excellent for *reviewing* existing code. It is not built to *produce* new code, and it only opens the channel loop at the very end (Oleg's triage).

Workflow 16 (Mafia) contributes one useful pattern we should not forget: the discussion node with multiple participants, for when the team needs to *debate* a decision rather than have one agent rule on it.

We steal what we want from each and build a tighter, interactive pipeline that knows how to *work*, not just review.

## What the ideal department looks like

Think of a small agile team given a single ticket. In a real engineering org with 8-12 people, that ticket would touch roughly eleven roles before it ships:

1. **Product Owner** — owns the "why," sets acceptance criteria, fields clarifying questions from the team.
2. **Tech Lead / Architect** — understands where the change fits in the system, identifies the blast radius, picks the scope.
3. **Research Engineer** — pulls in external knowledge: API docs, library behavior, comparable solutions, web search.
4. **Domain Expert** — knows the internal codebase history: prior incidents, existing conventions, undocumented trade-offs.
5. **Planner** — turns the analysis into a concrete plan: files to touch, test strategy, order of operations.
6. **Test Engineer** — writes the failing tests that pin down expected behavior (TDD red).
7. **Developer** — writes the minimum code to turn the tests green.
8. **CI Runner** — runs the test suite, reports results, enforces the "all tests pass" gate.
9. **Code Reviewer** — independent read: does the fix address the ticket, does it follow conventions, any regressions.
10. **Release Engineer** — git branch, worktree, commit hygiene, PR creation.
11. **Technical Writer** — final changelog entry, release notes, human-readable summary.

Collapsing this to an agent-per-role gives us an 11-agent workflow that is far too heavy for most tickets. But we should only collapse roles *after* listing them, because each role catches a specific class of mistake. Let's collapse deliberately:

- **Product Owner** → collapses into the channel loop with the user. The user is the product owner. The workflow's job is to know *when* to bother them.
- **Tech Lead** and **Planner** → collapse into one agent, the **Analyst**. Same role in a 5-person team.
- **Domain Expert** → collapses into the Analyst's mandatory knowledge-base search. The KB *is* the domain expert.
- **Research Engineer** → stays as its own agent, the **Researcher**. Runs in parallel with the Analyst because its work is independent (external knowledge vs. internal understanding).
- **Test Engineer**, **Developer**, **CI Runner**, **Code Reviewer**, **Release Engineer**, **Technical Writer** → all stay as distinct agents. Each one exists to catch a specific failure class, and they're cheap enough to keep separate.

That lands us at **seven agents plus two code nodes**, which is roughly the weight of workflow 28 with better role definition.

## The pipeline

Sketched in linear order with loops:

```
  Trigger (manual, accepts task description)
    │
    ▼
  [code] Setup Worktree
    │
    ├──────────────┐
    ▼              ▼
  Analyst     Researcher
  (interactive)  (non-interactive)
    │              │
    └──────┬───────┘
           ▼
         Merge
           │
           ▼
  Test Engineer (RED)   ◄─── user approval via channel loop when tests need clarification
           │
           ▼
      Implementer        ◄─── user approval via channel loop when judgment calls appear
           │
           ▼
      Test Runner
           │
           ▼
    [condition] Tests Pass?
       │           │
     false        true
       │           │
       ▼           ▼
   Implementer   Reviewer
    (loop)         │
                   ▼
           [condition] Approved?
              │           │
            false        true
              │           │
              ▼           ▼
          Implementer  Summarizer
           (loop)         │
                          ▼
                    [code] Teardown (commit, prepare PR)
                          │
                          ▼
                   Output (Claude Code channel)
```

### Node-by-node intent

**Trigger** — `manual`, free-text task description. The task can be a bug report, a feature request, a refactor brief, a GitHub issue body. Claude Code will be the one triggering it, so the input format is whatever Claude Code has in hand.

**Setup Worktree** — code node, same pattern as workflow 28. Creates `.worktrees/run/{runId}` on a branch named `task/run-{runId}`, sets the run's workspace `cwd` to the worktree path. Every downstream agent operates in that worktree so nothing touches the user's main working tree.

**Analyst** (interactive) — claude/sonnet. System prompt builds on the teach-agent pattern: MANDATORY KB search first, then read the relevant files, then produce a structured plan. The plan is what the Implementer will execute. Outputs: acceptance criteria, file list, risks, and any open questions. Ask User loop attached for any judgment call ("should I scope this fix to file A only or also file B?", "do you want backwards compat with X?"). Tools: Read, Grep, Glob, search_knowledge. KB: Dev Book (id 7).

**Researcher** (non-interactive, parallel with Analyst) — claude/haiku. Cheap. Runs in parallel with the Analyst because external research doesn't need the plan. WebSearch for API docs and best practices, WebFetch for specific pages, search_knowledge for any existing internal guidance on the same topic. Output: a short research brief the Analyst's plan can cite. Tools: WebSearch, WebFetch, search_knowledge.

**Merge** — combines Analyst plan and Researcher brief into a single object the Test Engineer will receive as input.

**Test Engineer (RED)** (interactive) — claude/sonnet. First agent after the merge. MANDATORY KB search — has to find the testing-lesson-export-over-inline doc (or any other testing lesson that applies) and obey it. Writes failing tests that express the acceptance criteria from the Analyst. Tests import from real source modules; if a helper isn't exported, the Test Engineer is authorized to export it (editing the production module is part of the test-writing job). Runs vitest to confirm tests are actually failing before handing off. Ask User loop for ambiguity ("the task says 'handle empty input', do you want that to throw or return a default?"). Tools: Read, Write, Edit, Bash, Grep, Glob, search_knowledge. KB: Dev Book.

**Implementer** (interactive) — claude/sonnet. Reads the RED tests and the Analyst plan, applies the minimum change to make the tests pass. System prompt forbids scope creep: no refactoring, no unrelated cleanup, no speculative abstractions, no defensive error handling for scenarios that can't happen. If the tests can't be satisfied without widening the scope, the Implementer must ask via channel loop before expanding. Tools: Read, Write, Edit, Bash, Grep, Glob, search_knowledge. KB: Dev Book.

**Test Runner** — claude/haiku. Runs `bun test` (or `vitest`) for the affected package, captures pass/fail, returns a structured output. No interpretation, no fixing — just execution. Tools: Bash, Read.

**Condition: Tests Pass?** — JavaScript expression checks the Test Runner output. On true, routes to Reviewer. On false, routes back to Implementer. Max retry count enforced by the Implementer's own turn counter (max 3 iterations of the loop; after that, escalate to user via the Implementer's ask_user).

**Reviewer** — claude/sonnet. Independent code review. Does the diff actually address the task? Does it follow project conventions (CLAUDE.md, the don't-over-engineer rules)? Any obvious regressions in related files? Outputs APPROVE or CHANGES_NEEDED with specific reasons. No channel loop — the reviewer is a silent gate. Tools: Read, Grep, Glob, search_knowledge. KB: Dev Book.

**Condition: Approved?** — on APPROVE, routes to Summarizer. On CHANGES_NEEDED, routes back to Implementer with the reviewer's reasons appended to the input.

**Summarizer** — claude/haiku. Writes a markdown report: what was changed, why, list of files, test results, any open questions the team couldn't resolve, any deviations from the original plan. This is what the user sees. Runs `git status` and `git diff --stat` for hard numbers. Tools: Read, Bash.

**Teardown** — code node. Stages all changes, creates a commit with a descriptive message derived from the trigger input, optionally pushes the task branch. Does NOT merge or open a PR automatically — that's a human call. Leaves the worktree intact at `.worktrees/run/{runId}` so the user can inspect if they want.

**Output** — Claude Code channel output, delivering the Summarizer's markdown report back to the Claude Code session that triggered the workflow.

## Loops and escalation

Three feedback loops are wired in:

1. **Test failure loop** — Test Runner → Condition → (fail) → Implementer. The Implementer sees the failing test output in its input and has another shot. Hard retry limit is 3 loop iterations, counted inside the Implementer's system prompt. On the third failure, the Implementer must call ask_user with the specific failure and propose a new approach.

2. **Review rejection loop** — Reviewer → Condition → (reject) → Implementer. Implementer sees the Reviewer's reasons in its input, applies targeted changes, and goes back through Test Runner → Reviewer. Retry limit is 2. On the second rejection, Implementer must ask user.

3. **Ask User loops** — Analyst, Test Engineer, and Implementer each have their own Ask User prompt node. Three separate prompt nodes, one per interactive agent, all labeled "Ask User" so the agents see them as a unified concept but they're wired only to the agent that owns them (so answers go back to the right agent). This is a deviation from the typical single-prompt pattern, and it's deliberate — it isolates the ask_user semantics per role.

## Knowledge base discipline

Every interactive agent (Analyst, Test Engineer, Implementer) and the Reviewer get the Dev Book (id 7) attached. Researcher gets it too, as a complement to web search. Test Runner, Summarizer, and the code nodes don't — they're mechanical.

Every agent system prompt starts with a MANDATORY search block, following the template the `teach-agent` skill prescribes:

```
## MANDATORY: Search the Dev Book BEFORE <action>

Before <doing the thing>, call search_knowledge with queries relevant to the task.
Run BOTH a topical query ("testing lesson", "error handling", "architecture")
AND a bug-specific query using the vocabulary of the task at hand.
Read every hit. If a lesson contradicts your first instinct, the lesson wins.
```

This is the supervised-learning loop we built with the teach-agent skill. Every time a workflow run produces a new failure mode worth capturing, we run teach-agent, the lesson lands in the Dev Book, and the next run of Tech Task Pipeline automatically benefits.

## Web search discipline

Only the Researcher has WebSearch/WebFetch by default. Rationale: giving web tools to every agent makes them drift off-task (reading Stack Overflow when they should be reading the codebase). The Researcher's job is to bring external knowledge back *once*, structured, at the top of the pipeline. If the Implementer or Reviewer discovers they genuinely need more external info, they ask the user, not the web, because the correct next step in that case is probably a scope conversation.

## What we are NOT building

To keep scope honest, here are things I considered and ruled out:

- **Separate security engineer agent.** Not for bug-fix tickets. The Reviewer and Analyst between them can flag obvious security concerns. A dedicated security agent earns its place on features that touch auth, crypto, or network boundaries — we can fork a variant of this workflow for that class of work later.
- **Separate best-practices agent.** Project conventions live in CLAUDE.md and the Dev Book. The Reviewer enforces them. A separate agent adds cost without adding signal.
- **Separate performance agent.** Performance work is so task-dependent that a generic agent is worthless. Performance tickets should use a different pipeline.
- **Discussion node from workflow 16.** Tempting for the "debate the design" use case, but for single-ticket bug-fix work it's overkill. Keep in mind for a future "design-spike pipeline" variant.
- **Parallel tracks (server vs. client) like workflow 14.** The pipeline runs one track; if a ticket touches both server and client the Analyst calls out the boundary and the Implementer handles both in order. Parallel tracks double the agent count for no win on small tickets.
- **Auto-PR creation.** Teardown creates a commit but does not open a PR. Opening a PR is a social action — commit messages, reviewers, labels, description — and deserves human judgment. The worktree stays, the branch stays, the user decides when to push.
- **Automatic merge to main.** Never, for obvious reasons.

## Success criteria

The pipeline is successful if, for a realistic tech task like issue #26:

1. The user hands off the task with one trigger call and a free-text description.
2. The Analyst asks at most one or two clarifying questions that a human product owner would reasonably want to answer.
3. The RED tests pin down the expected behavior correctly without inlining code copies (the testing lesson holds).
4. The Implementer produces a diff that passes the tests on the first or second loop iteration.
5. The Reviewer catches at least one issue the Implementer missed — if it never does, the Reviewer isn't earning its keep and should be cut.
6. The Summarizer's final report tells the user exactly what changed, what was tested, and what questions (if any) were left open.
7. The user's total active attention on the task is bounded: a few clarifying answers, one final approval. The rest is hands-off.

If the pipeline can do this for issue #26 end-to-end, we have dogfood. If it can't, we iterate on the roles and prompts.

## Open questions

These are the design decisions I want your input on before building:

1. **Who picks the model per agent?** My sketch uses claude/sonnet for thinking roles (Analyst, Test Engineer, Implementer, Reviewer) and claude/haiku for mechanical roles (Researcher, Test Runner, Summarizer). Cost-optimal but less engine diversity than workflow 28's Claude + OpenAI + Ollama mix. Do we want cross-engine diversity in the Reviewer (e.g. a second reviewer using OpenAI) for independent perspectives? It doubles Reviewer cost but catches model-specific blind spots.

2. **Does the Analyst or the Researcher get to run first?** My sketch runs them in parallel. Alternative: Analyst first, then Researcher scoped by the Analyst's plan. Parallel is faster but less focused; sequential is focused but adds latency. My vote: parallel, because the Researcher's work is cheap enough that wasted research is fine.

3. **How strict is the scope-creep guardrail on the Implementer?** CLAUDE.md says "no unrelated cleanup, no speculative abstractions, no defensive error handling for scenarios that can't happen." Should the Implementer's system prompt quote those rules verbatim? My vote: yes, and also give the Implementer permission to ask the user if something borderline comes up ("I notice this file has a related bug but fixing it is out of scope — skip, note in summary, or expand scope?").

4. **Should Teardown commit automatically or leave changes unstaged?** My sketch commits but doesn't push. Alternative: leave everything unstaged, let the user review and commit. Unstaged is safer but bloats the user's working tree. My vote: commit to a dedicated task branch, leave the branch checked out in the worktree, don't touch main.

5. **Do we need a separate "triage" agent before the Analyst?** For a task like "fix the bug in issue #26" the Analyst can handle both triage and planning. For a task like "the app is slow" we'd want a separate agent to figure out what "slow" means first. My vote: skip for v1, add later if real tasks demand it.

6. **Where does the failed-test log get surfaced?** When Test Runner fails three times in a row, the Implementer asks the user. The question needs to include the actual failing test output so the user can make a decision without digging. My vote: Implementer's ask_user prompt embeds the last Test Runner stdout/stderr.

7. **Knowledge base per role, or shared?** My sketch attaches Dev Book (id 7) to all thinking agents. Alternative: Analyst and Researcher share Dev Book; Test Engineer and Implementer get a more tightly scoped "testing conventions" KB if we ever split it. My vote: one KB for v1, split later if it gets unwieldy.

Answer any subset of these and we'll lock the design and build.

## Provisional next steps (only after plan is approved)

1. Create the workflow via `create_workflow` MCP with the seven agents + two code nodes + three condition nodes + three prompt loops + one merge.
2. Seed each agent's system prompt from templates derived from workflow 28's agents (Ches/Oleg) adapted for the role.
3. Register the workflow's channel MCP tool so Claude Code can trigger it by name.
4. Dogfood: trigger it on issue #26 as the first real task. If it passes the success criteria, promote it. If it fails, capture the failure modes via `teach-agent`.
