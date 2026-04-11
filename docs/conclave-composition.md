# Conclave Composition: Small Conclaves, Not One God Conclave

## Motivation

The Tech Task Pipeline started as one conclave that did everything: analyze, plan, test, implement, verify, review, summarize. Code Review went the same direction: one conclave with 11 agents covering 5 review perspectives plus best-practices plus writer.

Both work. Neither scales.

Every time a new role or capability is needed, the single-conclave pattern forces a choice: cram it into the existing pipeline (making it harder to reason about and slower to debug) or leave it out (missing real value). Adding a "best practices that writes back to KB" step to Code Review was already strain. Adding a "skeptical fixer that reads review output and applies fixes" would be stretch. Adding a "KB bookkeeper that prunes stale lessons" would break it.

The alternative: **atomic conclaves composed together**. Each conclave does one thing well. Composition happens at a higher level — either via a router agent, a new `subconclave` node type, or by direct trigger chaining.

This is the Unix philosophy applied to AI pipelines.

## Current state

- **`oc_devteam`** (Tech Task Pipeline, conclave 5) — one-shot technical task: analyze → test → implement → verify → review. Read-write.
- **`oc_review`** (Code Review, conclave 9) — depth audit of a single file: facts → specialists → best practices → lead reviewer → markdown. **Read-only.**

These two conclaves together expose the architectural gap:

| Tool | Audit | Fix | Interactive |
|---|---|---|---|
| Claude Code alone | weak | strong | strong |
| `oc_review` | **strong** | nil | nil |
| `oc_devteam` | weak | strong | medium |

No conclave reads a review output and skeptically fixes from it. That's the first gap.

Second gap: KB 1 is a shared write target (Best Practices writes to it during `oc_review`), but there's no curator. Captured lessons accumulate indefinitely and nothing checks them for staleness or contradiction. Poisoning is a plausible failure mode we got lucky on this session.

Third gap: there's no router. When a user says "do this task", they have to know which conclave to invoke. A dispatcher would pick for them.

## The architecture

Three new atomic conclaves. One new node type. One new concept (per-agent personal books). Two KB hygiene fixes.

### New conclave: `oc_review_fix`

**Role**: the skeptical fixer. Takes an `oc_review` output markdown (file path or content). For each finding:

1. Opens the cited location and re-reads the code
2. **Reproduces the failure mode in its head** before trusting the severity tag
3. Categorizes the finding:
   - `verified` → apply minimal fix
   - `false-positive` → reject with a documented reason
   - `ambiguous` → ask the user via channel loop
4. Applies fixes following CLAUDE.md hard rules (minimal diff, no surrounding refactor)
5. Outputs a report: fixes applied, findings rejected (+ why), findings escalated to user (+ answer)

**Key design principle**: skepticism of the review itself. The fixer is not an obedient executor — it's a second pair of eyes that happens to have commit access. The review is a *proposal*, not an instruction.

**Tools**: Read, Write, Edit, Grep, Glob, Bash, `knowledge_search` (KB 1), `personal_search`/`personal_add` (its own personal book).

**Does NOT write to KB 1.** Only `oc_review`'s Best Practices agent writes to the shared Dev Book. The Fixer may write to its *own personal book* (see below).

### New conclave: `oc_kb_audit`

**Role**: the Bookkeeper. Reads every document in a target knowledge base. For each lesson:

1. Grep the repo for cited file/symbol/function names — do they still exist?
2. Fetch cited source URLs (if any) — still reachable? still say what the lesson claims?
3. Grep recent commits for contradictions ("we used to X, but commit Y explicitly rejects X")
4. Check for duplicates and stale supersession chains
5. Categorizes each lesson: `valid / stale / contradicted / duplicate`
6. For anything non-`valid`: asks the user via channel loop — keep, update, or delete?
7. Outputs: audit report + applied changes

**Trigger mode**: on demand, not scheduled. Scheduling is the wrong model — pick a moment consciously. Run after noticeably increased write rates, after a suspicious citation, or after N reviews.

**Tools**: Read, Grep, Glob, Bash (for curl to KB delete/update endpoints), WebFetch.

### New conclave: `oc_dispatcher`

**Role**: the router. One agent, Haiku, one job:

1. Reads the input (a free-text task description)
2. Inspects the catalog of available conclaves from its system prompt
3. Decides which conclave best fits the input
4. Calls that conclave's HTTP trigger endpoint (`POST /api/conclaves/:id/run`) via Bash + curl (or via a `subconclave` node once that's built)
5. Returns the dispatched run ID and a one-line summary of the decision

**Why one agent?** Because the dispatcher's job is a single classification decision. One-agent conclaves are the right size for decisions, not for work.

**Tools**: Bash, `knowledge_search` (KB 1, for picking up routing heuristics the user has captured).

This is the simplest possible conclave, but it unlocks the "few conclaves" pattern because now there's one entry point that routes to specialists.

## New primitive: `subconclave` node type

Current node types: `trigger`, `agent`, `condition`, `code`, `merge`, `prompt`, `output`. Adding:

**`subconclave`** — runs a target conclave as a step in a larger pipeline.

```ts
{
  id: "review_step",
  type: "subconclave",
  config: {
    conclaveId: 9,      // target conclave (oc_review)
    passInput: true,    // pass this node's input as the sub-run's payload
  },
}
```

**Executor behavior**: when the graph walker hits a `subconclave` node, it calls `POST /api/conclaves/:conclaveId/run` with the node's input, subscribes to the run event stream, waits for completion, and passes the sub-run's final output as this node's output.

**Why this matters**: without it, composition requires a `code` node with Python/curl and polling. That works but is clunky. With it, you can wire a full review → fix → re-verify meta-pipeline in 5 nodes:

```
trigger → review (subconclave, oc_review)
        → fix (subconclave, oc_review_fix)
        → verify (subconclave, oc_review)
        → output
```

**Fallback that works today**: use a `code` node to curl the run API and poll for completion. Can ship dispatcher + composition today via this fallback; migrate to `subconclave` once built.

## New concept: per-agent personal books

**The idea**: each agent in a conclave can have its own private knowledge base — a "personal book" — that acts as a durable, role-specific replacement for Claude Code's memory + shared RAG.

**Why**: Claude Code's memory is per-user, per-project, ephemeral across Claude-Code sessions, and not exposed to conclave agents. The shared Dev Book (KB 1) is good for cross-cutting project wisdom but pollutes when every agent writes to it. A per-agent personal book:

- **Persists across runs**, durably stored in the KB system
- **Scoped to the agent's role**, no cross-pollution between specialists
- **Reviewable and editable** in the existing KB UI
- **Exchangeable** — dump one agent's book, give it to someone else's OC instance
- **Composable** with the shared KB 1 — the agent reads from both

### Mechanics

Agent config gains:

```ts
{
  engine: "claude",
  model: "sonnet",
  personalBookId: 23,   // KB id for this agent's personal book
  tools: [...],
}
```

When `runClaudeAgent` starts an agent with `personalBookId` set, it automatically attaches two in-process SDK MCP tools:

- **`personal_search(query, top_k)`** — semantic search scoped to the personal book only
- **`personal_add({ title, why, howToApply, source })`** — adds a new lesson to the personal book

These are **separate from** the shared `knowledge_search` / `knowledge_fetch` tools (which operate on any KB the agent has read access to via its tool declarations).

### Usage pattern

The agent's system prompt gains a two-beat rhythm:

**Before forming opinions**:
> Your personal book contains lessons from your own past runs. Call `personal_search` with queries relevant to the file, symbols, and patterns you're reviewing. Prefer your personal book over your instinct — it's a record of what you've learned through practice.

**After forming opinions**:
> If this run surfaced a durable, concrete, code-verifiable lesson (not a one-off observation), call `personal_add` to capture it. The lesson must be: (a) specific enough that you'd act on it next time, (b) general enough that it applies to more than just this file, (c) falsifiable — you could tell if the lesson became wrong.

### Capture criteria (anti-poisoning)

The `personal_add` prompt MUST require:
- **A concrete cause**: "In this codebase, drizzle's `.get()` returns undefined on empty" — verifiable by running the code.
- **A concrete effect**: "Always null-check before property access" — actionable rule.
- **A falsifiability clause**: "If `.get()` starts throwing in a future drizzle version, this lesson is stale and should be updated."

Vague lessons ("write better code") or self-flattering lessons ("my first instinct is usually right") get rejected by the prompt.

### Personal book vs shared Dev Book

| Shared Dev Book (KB 1) | Personal Book (per agent) |
|---|---|
| Cross-project wisdom | Role-specific learned behavior |
| Written by Best Practices agent (in `oc_review`) | Written by the agent itself |
| Many readers | One reader (the owning agent) |
| Audited by `oc_kb_audit` | Audited by `oc_kb_audit` on demand |
| Curated by Best Practices + Bookkeeper | Curated by the agent + Bookkeeper |

**Invariant: one writer per book.** The shared Dev Book has one writer (Best Practices). Each personal book has one writer (the owning agent). This is what keeps either book from becoming a log.

### Bootstrap problem

A fresh personal book is empty and useless until the agent has run enough times to capture meaningful lessons. Two mitigations:

1. **Seed with role-specific starter lessons** when the agent is created. The user (or a new `oc_seed_personal_book` conclave) writes 3–5 starter lessons from the agent's role description.
2. **Fall back to shared KB 1** when `personal_search` returns nothing. The agent's prompt says: "If your personal book has no relevant hit, fall back to `knowledge_search` on the shared Dev Book."

Over time, each personal book accumulates role-specific lessons that don't belong in KB 1 but are invaluable for that role.

### Scale concern

One conclave with 11 agents could have 11 personal books. Ten such conclaves = 110 books. The KB UI needs to handle this: grouping by owning conclave, filtering by agent role, archiving unused books. Not a blocker, but a design constraint for the UI.

## KB hygiene: two-prong

The poisoning concern (a wrong lesson gets captured once and every subsequent review cites it as ground truth) deserves two separate mitigations.

### Cheap prong: per-review skepticism in Best Practices

Modify the Best Practices agent's system prompt:

> When you find a relevant KB entry via `knowledge_search`, you MUST `knowledge_fetch` the full body and verify the lesson still makes sense *against the code you're reviewing right now*. If the lesson contradicts what the code actually does (e.g., the lesson was captured from a now-refactored pattern), tag the citation as `[KB stale]` instead of `[KB hit]` and do NOT cite it as authoritative. Instead, note the staleness as a finding for the Bookkeeper to review.

One prompt change. Zero new code. Catches ~80% of the poisoning risk.

### Thorough prong: standalone `oc_kb_audit`

The Bookkeeper conclave described above. Runs on demand. Catches the remaining 20% — staleness that Best Practices didn't notice because the lesson wasn't cited in the current review.

Both prongs together: Best Practices flags staleness in-flight during reviews; Bookkeeper does periodic deep audits on demand.

## Implementation order

The goal is incremental — each step delivers value on its own and doesn't require the next.

1. **Now — Best Practices KB skepticism**. One prompt change in the Code Review conclave. Use the oc-dev MCP plugin's `update_node` tool to patch the Best Practices agent's system prompt. Zero new code. Zero risk.

2. **Soon — `oc_review_fix` conclave**. Build via `create_conclave` MCP tool. Unblocks the "fix from review output" workflow we currently do manually. The Fixer uses Bash + curl for personal book access until proper tooling lands.

3. **When needed — `oc_kb_audit` conclave**. Build via `create_conclave` when the KB starts showing signs of growth-without-pruning. Not urgent until then — the cheap prong above covers near-term risk.

4. **After 3+ production conclaves exist — `oc_dispatcher`**. A router is pointless until there's something to route between. Build once we have `oc_review`, `oc_review_fix`, `oc_devteam`, and a reasonable 4th.

5. **Server-side — `subconclave` node type**. Modest server change: new node type in the shared schema, executor handler that calls the run API and waits. The `code` node fallback keeps everything working until this lands. Implement when composition gets too clunky via curl.

6. **Runtime — personal book tools**. Add `personal_search` and `personal_add` in-process SDK MCP tools to `runClaudeAgent` in `packages/server/src/agent/runtime.ts`. Gated on `personalBookId` in agent config. Update `conclaveNodeSchema` in `@openconclave/shared` to allow `personalBookId: z.number().int().optional()` on agent configs. Small, mechanical change.

7. **UI — personal book discoverability**. Update the agent inspector in the conclave editor to show the attached personal book ID and a link to view/edit it. Update the knowledge page to group books by owning conclave. Deferred — not blocking.

## Open questions

- **Who owns an agent's personal book lifecycle?** If an agent node is deleted, should its personal book be deleted? Probably not — it's a durable record that might be valuable even after the conclave is dismantled. Make it an explicit user decision.
- **What happens on `create_conclave` when an agent declares a `personalBookId` that doesn't exist?** Auto-create the book with the agent's role name? Or require the user to pre-create it? I'd auto-create on first run, but flag in the logs.
- **Does the Dispatcher need its own personal book?** Probably yes — routing heuristics are exactly the kind of lesson that compounds. "When the input mentions `.ts` files and `review`, always dispatch to `oc_review`".
- **How does the subconclave node pass state between runs?** The target sub-run's output is already captured as the subconclave node's output. But does the sub-run inherit the parent run's workspace cwd? Agents' session IDs? Open.
- **`oc_kb_audit` for personal books**: does it audit every personal book on every run, or just the one the user specifies? Specifying is cleaner — "audit Correctness agent's personal book" is a different operation from "audit KB 1".

## Invariants worth naming

1. **One writer per book.** No book has more than one writing role. The shared Dev Book has Best Practices. Each personal book has its owning agent. The Bookkeeper is an editor (curator), not an author.
2. **Many readers.** Any agent can read any book it has been granted access to via its tool config.
3. **Best Practices is the only shared-KB author.** No other role writes to KB 1. Even the Fixer, even the Dispatcher, even the Bookkeeper (which only edits).
4. **Personal books are private.** An agent's personal book is not readable by other agents in the same conclave — only by the owning agent (and the Bookkeeper during audit).
5. **Lessons are falsifiable.** Every captured lesson, in any book, must specify under what condition it would become wrong. Non-falsifiable lessons get rejected at capture time.
