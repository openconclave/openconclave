# OpenConclave — project-level instructions for Claude Code

You are working on OpenConclave (OC), a multi-agent conclave platform. Server in `packages/server`, shared types and schemas in `packages/shared`, client in `packages/client`. Conclaves are stored in the DB; build or modify them via the `openconclave-dev` MCP plugin (`create_conclave`, `update_conclave`, `update_node`), never via `scripts/build-*.ts`.

## Your personal book: KB 2 "OCParther"

You have a durable personal knowledge base at KB 2, named **OCParther**. It replaces Claude Code's per-session auto-memory with something persistent, scoped to your work on OpenConclave specifically, editable by the user, and auditable.

**The user is the editor; you are the sole author.** Only you write to this book. The user reviews, edits, prunes, or deletes entries as they see fit.

### When to read

At the start of any session where you're working on OC — before you form an approach, before you decide what to build or fix, before you argue with the user about a design tradeoff — **search your personal book first**. If a past-you wrote a lesson relevant to what you're about to do, follow it. If the lesson contradicts your first instinct, the lesson wins.

Read via the OC HTTP API:

```bash
# Semantic search inside KB 2
curl -s -X POST "http://localhost:4000/api/knowledge/2/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "<your query>", "topK": 5}'

# List all documents in KB 2
curl -s "http://localhost:4000/api/knowledge/2/documents"

# Fetch one document fully (metadata + content)
curl -s "http://localhost:4000/api/knowledge/2/documents/<doc_id>"
```

You do NOT have `knowledge_search` as an in-process tool in Claude Code — only conclave agents get that. Use Bash + curl.

### When to write

Sparingly. One lesson per genuinely new insight, not per session event. Each entry must meet these criteria:

- **Concrete**: names a specific pattern, file, command, library, symbol, or class of bug
- **Falsifiable**: has a clause describing under what condition the lesson becomes wrong (e.g. "if the SDK fixes X in version Y, this lesson supersedes")
- **Actionable**: future-you knows what to DO differently after reading it, not just what to think about

Write via the OC HTTP API (the `ingest` endpoint accepts `{text, filename}`, not `{content, filename}`):

```bash
# Put the JSON in a temporary file to avoid shell escaping pain on long markdown
cat > /tmp/lesson.json <<'JSON'
{
  "filename": "lesson-<kebab-case-title>.md",
  "text": "# <Title>\n\n**Why**: <concrete reason with cited example>\n\n**How to apply**: <actionable rule>\n\n**Falsifiable when**: <condition that would make this wrong>\n\n**Source**: <commit hash, session date, URL, or review run>"
}
JSON

curl -s -X POST "http://localhost:4000/api/knowledge/2/ingest" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/lesson.json
# Returns: {"data":{"documentId":N}}
```

Filenames always start with `lesson-` and are kebab-case.

### What NOT to write

- Session-specific events ("we shipped v1.0.9", "run 58 fixed issue #30"). Project history lives in git log and `.notes/`.
- One-off fix outcomes ("I changed line 42 of runtime.ts"). Belongs in commit messages.
- Vague principles ("write clean code"). Not actionable.
- Self-flattering observations ("my first instinct is usually right"). The book exists to catch when it isn't.

### When to re-read an existing entry and update it

If you find yourself about to write a lesson that contradicts or supersedes an existing one, **update the existing entry** (delete + re-add with the new content) rather than creating a second conflicting lesson. Duplicates poison the book.

### Invariant

**One writer (you), one editor (the user).** If something you wrote is wrong or obsolete, expect the user to fix it — that's not a failure, that's the design. The book staying healthy depends on the user being willing to edit it.

## Other project-specific rules

- **Build conclaves via the oc-dev MCP plugin**, never via `scripts/build-*.ts`. `scripts/build-tech-task-pipeline.ts` is grandfathered; new conclaves go through `create_conclave`.
- **Agent filesystem tools on the Claude path go through `mcp__oc__*`** (in-process), not the Claude Code CLI's builtin `Read`/`Write`/`Edit`. See commit `077da22` for the fix and entry `04-issue-30-fix.md` in `.notes/` for the rationale.
- **Review files live in `.reviews/`** (git-ignored). Review-fix files live in `.worktrees/review-fix/<runId>/` (also git-ignored).
- **Design doc for the overall conclave architecture direction**: `docs/conclave-composition.md`.
- **Lab journal for the 2026-04-11 session**: `.notes/` (6 entries + README).

## Hard rules (same as the global CLAUDE.md)

These are imported from the global Claude Code rules but worth naming here since they come up a lot in this codebase:

- Don't add features, refactor, or introduce abstractions beyond what the task requires. A bug fix doesn't need surrounding cleanup.
- Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees. Only validate at system boundaries.
- Default to writing no comments. Only add one when the WHY is non-obvious.
- Don't explain WHAT the code does, since well-named identifiers already do that. Don't reference the current task, fix, or callers.
- For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete.
- Avoid backwards-compatibility hacks: renamed `_vars`, re-exporting types, `// removed` comments for removed code.
- For risky or hard-to-reverse actions (`git reset --hard`, force push, deleting branches, modifying shared infrastructure), confirm with the user before proceeding.
