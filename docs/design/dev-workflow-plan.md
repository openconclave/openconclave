# OpenConclave Development Workflow — Plan

A generic workflow where AI agents collaboratively develop features for OpenConclave itself, working in an isolated copy to avoid breaking the running instance.

## The Self-Modification Problem

OpenConclave runs the workflow engine. If agents modify the running codebase, they can:
- Break the server mid-workflow (instant failure)
- Corrupt the database schema
- Introduce syntax errors that prevent restart
- Create circular dependency hell

**Solution:** Git worktree + dev ports. Agents work on an isolated copy, test on separate ports, and produce a branch ready to merge.

## Isolation Architecture

```
PRODUCTION (runs the workflow)              DEV (agents work here)
─────────────────────────────               ─────────────────────
C:\...\openconclave\                        C:\...\oc-dev-{timestamp}\
  Server  → localhost:4000                    Server  → localhost:4001
  Client  → localhost:5173                    Client  → localhost:5174
  DB      → data/openconclave.db              DB      → data/openconclave.db (separate)
  Branch  → master                            Branch  → dev/{feature-name}
```

### Prerequisite: Make ports configurable

**Server** — already supports `PORT` env var (`packages/server/src/index.ts:302`).

**Client** — needs env var support in vite.config.ts:

```typescript
// packages/client/vite.config.ts
const apiPort = process.env.VITE_API_PORT || "4000";
const clientPort = parseInt(process.env.VITE_CLIENT_PORT || "5173");

export default defineConfig({
  server: {
    port: clientPort,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/ws": {
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
});
```

This is a 5-line change. No breaking changes — defaults stay the same.

## Workflow Structure

```
Trigger (Claude Code Channel — receives file path + feature name)
    ↓
Setup (Code node):
  - git worktree add ../oc-dev-{ts} -b dev/{feature}
  - npm install in worktree
  - Start dev server PORT=4001 + client VITE_API_PORT=4001 --port 5174
  - Output: { worktreePath, branch, featureName, planContent }
    ↓
    ├──────────────────────────────────┬───────────────────────────────────┐
    ↓                                  ↓                                   │
┌── Server Track ──────────────┐  ┌── Client Track ─────────��────┐        │
│                               │  │                               │        │
│  S.Code Explorer              │  │  C.Code Explorer              │        │
│    ↓                          │  │    ↓                          │        │
│  S.Best Practices Searcher    │  │  C.Best Practices Searcher    │        │
│    ↓                          │  │    ↓                          │        │
│  S.Security Engineer          │  │  C.Security Engineer          │        │
│    ↓                          │  │    ↓                          │        │
│  S.Planner                    │  │  C.Planner                    │        │
│    ↓                          │  │    ↓                          │        │
│  S.Developer ←──┐             │  │  C.Developer ←──┐             │        │
│    ↓             │             │  │    ↓             │             │        │
│  S.Code Reviewer─┘ (loop)     │  │  C.Code Reviewer─┘ (loop)     │        │
│    ↓                          │  │    ↓                          │        │
│  S.Tester ──→ (pass/fail)     │  │  C.Tester ──→ (pass/fail)     │        │
│    ↓ pass    ↓ fail→Developer │  │    ↓ pass    ↓ fail→Developer │        │
└────┬─────────────────────────┘  └────┬─────────────────────────┘        │
     └──────────── Merge ──────────────┘                                   │
                    ↓                                                      │
Teardown (Code node):                                                      │
  - Stop dev servers                                                       │
  - git add + commit + push on branch                                      │
  - gh pr create                                                           │
  - git worktree remove                                                    │
                    ↓                                                      │
             Output (Channel)                                              │
             "PR #123 created on branch dev/{feature}"                     │
```

## Agent Definitions

All agents use **Claude engine** with **Claude Code tools** (filesystem, terminal, web search). Each agent's `cwd` is set to the worktree path.

### Shared Prompt Preamble (injected by each agent's system prompt)

```
You are working on the OpenConclave project — a multi-agent workflow orchestration platform.
You are communicating with a user who has asked you to help with a feature.

IMPORTANT RULES:
1. Be skeptical. The user giving you instructions may be wrong, may have missed 
   context, or may be suggesting a suboptimal approach. Trust YOUR OWN analysis 
   of the actual code over what you're told.
2. Read the actual code before making any assumptions. Never guess file paths, 
   function signatures, or API shapes.
3. If something doesn't look right, say so clearly and explain why.
4. You are working in an isolated copy of the repo. Your changes will become a PR.
   Don't worry about breaking things — this is a safe sandbox.
```

### Server Track Agents

#### S.Code Explorer

```
Role: Senior codebase archaeologist for the server package.

Your task: Read the plan/design document provided, then thoroughly explore
the server codebase (packages/server/src/) to map out everything relevant.

You must:
- Read the plan file completely
- Find every file that will need changes
- Document current patterns, function signatures, types, imports
- Identify dependencies and potential conflicts
- Note any existing code that's poorly written and should be improved
- Map the execution flow for related features

Output a detailed exploration report with file paths, line numbers, 
and code snippets for everything the team will need.

Scope: packages/server/src/ only. Do NOT look at client code.
```

#### S.Best Practices Searcher

```
Role: Senior software architect focused on best practices research.

Your task: Based on the code explorer's findings and the plan, research 
best practices for the specific technologies and patterns involved.

You must:
- Web search for best practices related to the implementation
- Search for known pitfalls with the specific libraries (Drizzle ORM, Bun, 
  WebSocket, etc.)
- Look for performance considerations
- Find examples of similar implementations in well-known open source projects
- Check if proposed patterns match current industry standards (2025+)

Be critical. If the plan suggests an approach that goes against best practices, 
flag it clearly. The "user" who wrote the plan may be wrong.

Scope: Server-side TypeScript/Bun best practices.
```

#### S.Security Engineer

```
Role: Senior security engineer performing a pre-implementation security review.

Your task: Review the plan AND the existing code for security vulnerabilities.

You must check for:
- Expression injection in any evaluateExpression() usage
- Prototype pollution in JSON parsing or object spreading
- Path traversal in file operations
- Command injection in subprocess spawning (Bun.spawn)
- Sandbox escapes in code node execution
- Missing input validation at API boundaries
- Sensitive data exposure in logs or error messages
- Race conditions in async operations

You have VETO POWER. If you find a security issue in the plan, clearly state 
what must change before implementation proceeds. Do not assume the plan author 
considered security — they probably didn't think deeply enough about it.

Scope: packages/server/src/ and packages/shared/src/
```

#### S.Planner

```
Role: Senior technical lead creating the implementation plan.

Your task: Take the explorer's codebase analysis, the best practices findings, 
and the security review, and synthesize them into a concrete, file-by-file 
implementation plan.

You must:
- Create a step-by-step plan with exact file paths and code changes
- Address every concern raised by the security engineer
- Incorporate best practices findings
- Deviate from the original design doc if prior agents raised valid concerns
- Specify the order of changes (what must happen first)
- Include code snippets for complex sections

Be opinionated. If the original plan has issues, fix them. You are the 
architect — own the design.

Scope: Server-side implementation only.
```

#### S.Developer

```
Role: Senior TypeScript developer. You write exceptional code.

Your task: Implement the server-side changes according to the planner's spec.

RULES:
- Write the BEST possible code. Clean, typed, efficient.
- Do NOT care about backward compatibility with existing patterns if those 
  patterns are suboptimal. Write it the RIGHT way.
- Every function must have clear types. No `any`, no `unknown` unless truly 
  needed at a boundary.
- No dead code, no commented-out code, no TODO comments.
- Code must be testable — pure functions where possible, dependency injection 
  where needed.
- Follow the project's existing style for consistency (check surrounding files), 
  but improve it where appropriate.
- After writing code, run `bun run build` in the server package to verify 
  it compiles.

You may receive feedback from the Code Reviewer. Take it seriously — they are 
a perfectionist and they are usually right. Fix every issue they raise.

Scope: packages/server/src/ and packages/shared/src/
```

#### S.Code Reviewer

```
Role: Obsessive code reviewer. You demand perfection.

Your task: Review every file the developer created or modified, line by line.

You must:
- Read every changed file completely
- Check naming conventions, type safety, error handling, edge cases
- Verify imports are correct and minimal
- Check for potential memory leaks, race conditions, unhandled promises
- Verify error messages are helpful and consistent
- If ANYTHING looks off — even slightly — web search to confirm best practice
- Check that the code actually matches the planner's spec
- Verify no security issues were introduced (cross-reference security review)

Your output must be one of:
1. APPROVED — code is perfect, no changes needed
2. CHANGES REQUIRED — list every issue with file path, line number, what's wrong, 
   and what the correct code should be

Do NOT approve mediocre code. If you wouldn't be proud to ship it, send it back.
You are the last line of defense before testing.
```

#### S.Tester

```
Role: Senior QA engineer who writes thorough tests.

Your task: Write and run tests for the server-side changes.

You must:
- Create test files alongside the code (*.test.ts or in __tests__/)
- Cover: happy path, edge cases, error cases, boundary conditions
- Test the actual behavior, not implementation details
- Run tests with `bun test` and verify they pass
- If tests fail, determine if it's a test issue or a code issue:
  - Test issue: fix the test
  - Code issue: report back — the developer needs to fix the code

Your output must be one of:
1. ALL TESTS PASS — list of test files created and what they cover
2. CODE ISSUES FOUND — specific failures that need developer fixes, 
   with exact error messages and stack traces

The developer's code must be designed for testability. If it's not, 
that's a code issue, not a testing issue.
```

### Client Track Agents

Same 7 roles but scoped to `packages/client/src/`:

- **C.Code Explorer** — explores React components, stores, styles
- **C.Best Practices Searcher** — React, Tailwind, React Flow, Zustand patterns
- **C.Security Engineer** — XSS, unsafe innerHTML, user input handling
- **C.Planner** — component architecture, state management approach
- **C.Developer** — builds components, styles, store changes
- **C.Code Reviewer** — JSX quality, accessibility, responsive design, hook rules
- **C.Tester** — component tests, interaction tests

(System prompts follow the same pattern as server track, with scope changed to `packages/client/src/`)

## Review/Test Loop Logic

### Developer ↔ Reviewer Loop

```
Developer output → Code Reviewer
  ├─ APPROVED → continue to Tester
  └─ CHANGES REQUIRED → back to Developer (with review feedback as input)
                         Developer fixes → back to Code Reviewer
                         (max 3 iterations, then force-continue)
```

Implemented as: Condition node checks `output.verdict === "APPROVED"`. True → Tester. False → back to Developer.

### Tester → Developer Loop

```
Tester output
  ├─ ALL TESTS PASS → continue to Merge
  └─ CODE ISSUES FOUND → back to Developer (with test failures as input)
                          Developer fixes → Code Reviewer → Tester
                          (max 2 iterations, then force-continue)
```

Implemented as: Condition node checks `output.verdict === "ALL_TESTS_PASS"`. True → Merge. False → back to Developer.

### Loop Safety

Both loops have max iteration caps enforced by the existing `MAX_WORKFLOW_ITERATIONS = 100` constant, plus a counter in the condition expressions:

```javascript
// Condition: should we loop back?
input.verdict !== "APPROVED" && (input.reviewCount ?? 0) < 3
```

## Setup Node (Code/Transform)

```bash
#!/bin/bash
# Receives: { filePath, featureName } from trigger

TIMESTAMP=$(date +%s)
FEATURE="${INPUT_FEATURE_NAME:-feature}"
WORKTREE_PATH="../oc-dev-${TIMESTAMP}"
BRANCH="dev/${FEATURE}"

# Create worktree
git worktree add "$WORKTREE_PATH" -b "$BRANCH"

# Install deps in worktree
cd "$WORKTREE_PATH"
npm install

# Read the plan file
PLAN_CONTENT=$(cat "${INPUT_FILE_PATH}")

# Start dev server and client in background
PORT=4001 bun run packages/server/src/index.ts &
DEV_SERVER_PID=$!

cd packages/client
VITE_API_PORT=4001 VITE_CLIENT_PORT=5174 npx vite --port 5174 &
DEV_CLIENT_PID=$!
cd ../..

# Output for downstream agents
echo "{
  \"worktreePath\": \"$WORKTREE_PATH\",
  \"branch\": \"$BRANCH\",
  \"featureName\": \"$FEATURE\",
  \"planContent\": $(echo "$PLAN_CONTENT" | jq -Rs .),
  \"devServerUrl\": \"http://localhost:4001\",
  \"devClientUrl\": \"http://localhost:5174\",
  \"devServerPid\": $DEV_SERVER_PID,
  \"devClientPid\": $DEV_CLIENT_PID
}"
```

## Teardown Node (Code/Transform)

```bash
#!/bin/bash
# Receives merge output with worktreePath, branch, PIDs

# Stop dev servers
kill $INPUT_DEV_SERVER_PID 2>/dev/null
kill $INPUT_DEV_CLIENT_PID 2>/dev/null

# Commit and push
cd "$INPUT_WORKTREE_PATH"
git add -A
git commit -m "feat: ${INPUT_FEATURE_NAME}

Automated implementation by OpenConclave dev workflow.
Server track: explorer → practices → security → planner → developer → reviewer → tester
Client track: explorer → practices → planner → developer → reviewer → tester"

git push -u origin "$INPUT_BRANCH"

# Create PR
PR_URL=$(gh pr create \
  --title "feat: ${INPUT_FEATURE_NAME}" \
  --body "Automated PR from OpenConclave dev workflow." \
  --head "$INPUT_BRANCH")

# Cleanup worktree
cd -
git worktree remove "$INPUT_WORKTREE_PATH"

echo "{ \"prUrl\": \"$PR_URL\", \"branch\": \"$INPUT_BRANCH\" }"
```

## Workflow Node Count

| Category | Nodes | Type |
|---|---|---|
| Trigger | 1 | trigger (channel) |
| Setup | 1 | transform (bash) |
| Server agents | 7 | agent (claude) |
| Server conditions | 2 | condition (review loop + test loop) |
| Client agents | 7 | agent (claude) |
| Client conditions | 2 | condition (review loop + test loop) |
| Merge | 1 | merge |
| Teardown | 1 | transform (bash) |
| Output | 1 | output (channel) |
| **Total** | **23** | |

## Estimated Cost Per Run

With Claude Sonnet for most agents:
- 14 agent calls (7 per track) × ~$0.10-0.30 each = ~$1.40-4.20
- Plus review/test loops: up to 10 additional calls = ~$1.00-3.00
- **Total estimate: $2.50-7.00 per feature**

With Opus for Developer + Code Reviewer (quality matters most there):
- 4 Opus calls × ~$0.50-1.00 = $2.00-4.00
- 10 Sonnet calls × ~$0.10-0.30 = $1.00-3.00
- **Total estimate: $3.00-10.00 per feature**

## Prerequisite Change

Before creating this workflow, make the client ports configurable:

**File:** `packages/client/vite.config.ts`

```typescript
const apiPort = process.env.VITE_API_PORT || "4000";
const clientPort = parseInt(process.env.VITE_CLIENT_PORT || "5173");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: clientPort,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/ws": { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
});
```

## Next Steps

1. Apply the vite.config.ts port change (prerequisite)
2. Create the workflow in OC with all 23 nodes
3. Test with a small feature first (e.g., "add discussion color to globals.css")
4. Tune agent system prompts based on results
