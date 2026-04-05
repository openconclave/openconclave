# Workflows: When to Use and How to Build Them

## When to Use a Workflow vs a Single Agent

### Use a single agent when:
- The task is straightforward (rename, bug fix, simple feature)
- You need speed — a single agent completes in minutes
- Cost matters — single agent runs are 10-50x cheaper
- Full context is important — one agent sees everything at once

### Use a workflow when:
- The task is ambiguous or spans multiple systems (server + client + shared types)
- Getting the plan wrong is expensive — you want structured debate before code is written
- You need role enforcement — planners shouldn't code, reviewers shouldn't fix bugs, testers shouldn't modify source
- You want an audit trail — who said what, who disagreed, and how it was resolved
- The task benefits from parallel exploration — multiple agents researching different areas simultaneously

### Rule of thumb
If you'd spend more than 30 minutes going back and forth with a single agent to get the approach right, a workflow front-loads that into structured debate so the implementation phase is clean.

## Workflow Architecture Patterns

### Discussion Nodes — Three Connection Points

Discussion nodes have three distinct connection points:

1. **Top** — Context/Input: data that feeds into the discussion as background. All participants see this via the `{{input}}` template variable.
2. **Left** — Participants: agent nodes that speak during the discussion. The moderator calls on them in rounds.
3. **Bottom** — Output: the discussion result flows to the next node.

### Template Variables in Discussion Prompts

Discussion participant prompts support these variables:
- `{{input}}` — context data from upstream non-participant nodes (transforms, triggers, other discussions)
- `{{transcript}}` — accumulated conversation history from all rounds
- `{{agentName}}` — the current participant's label
- `{{round}}` — current round number

**Important:** If you don't include `{{input}}` in your prompt template, participants won't see any upstream context. Always include it:

```
Context:
{{input}}

Transcript:
{{transcript}}

You are {{agentName}}. [instructions here]
```

### Moderator Design

The moderator is an agent that decides who speaks next and when to end the discussion. A good moderator prompt should:

1. Define the meeting's purpose clearly
2. Specify what to look for (conflicts, gaps, alignment issues)
3. Describe when to call agents back for clarification
4. Define the exit condition (when to end the discussion)

Example (Pre-Task Meeting):
```
You are moderating the Pre-Task Meeting. Three explorers present findings.

Your job:
1. Have each explorer present their findings
2. Identify conflicts between their reports
3. When conflicts exist: ask the relevant explorers to clarify and reconcile
4. When all conflicts are resolved: produce a unified briefing, then end

Do NOT let the discussion drift into planning — this meeting is about understanding current state.
```

### Role Separation

Each agent should have a single, clear responsibility:

| Role | Can Do | Cannot Do |
|------|--------|-----------|
| Explorer | Read code, search, report findings | Suggest changes |
| Planner | Design implementation plans | Write code |
| Developer | Write code per plan | Write tests, refactor beyond plan |
| Reviewer | Read code, flag issues | Fix code, write tests |
| Test Writer | Write tests | Fix source code bugs |

This prevents scope creep and ensures each agent's output is focused.

### Code Transform — Input Parsing

Code/transform nodes receive input on stdin as JSON:

```json
{
  "input": <predecessor_node_output>,
  "context": {
    "workflowId": 20,
    "runId": 113,
    "nodeId": "transform_123"
  }
}
```

When the predecessor is a trigger, the input is the trigger payload:
```json
{
  "input": {
    "input": "{\"featureName\": \"...\", \"filePath\": \"...\"}",
    "_callerCwd": "C:\\Users\\..."
  },
  "context": { ... }
}
```

Note the double nesting — `data["input"]` gives the trigger payload, which itself has an `"input"` field containing the user's JSON string.

## Common Pitfalls

### 1. Empty plan content
If your setup transform reads a task file from a git worktree, the file must be **committed** to the repo. Uncommitted files don't exist in worktrees.

### 2. Agents saying "I'm ready" instead of working
This happens when:
- The discussion prompt doesn't include `{{input}}` — agents can't see the task
- The plan/task content is empty (see pitfall #1)
- The model is too small to be proactive with tool usage

### 3. Discussion rounds burning without progress
- Set `maxRounds` appropriately: 5 for exploration meetings, 10-15 for dev coordination
- Make the moderator directive: "have each agent present, then check for conflicts" not just "moderate the discussion"

### 4. Agents crossing role boundaries
Without explicit constraints in system prompts, agents will:
- Explorers suggest code changes
- Reviewers fix bugs themselves
- Developers add tests "while they're at it"

Always include explicit "Do NOT" instructions in system prompts.

## Cost Optimization

- Use cheap models (Haiku) for exploration and planning phases — they're reading and summarizing, not coding
- Use stronger models (Sonnet) for developers and reviewers — they need to write correct code
- Keep moderator on cheap models — moderation is a simple routing decision
- Set `maxTurns` and `maxBudgetUsd` on agent nodes to prevent runaway costs
- Competitors Analyser is the most expensive agent (web search) — consider skipping it for internal-only tasks

## Example: Dev Pipeline Structure

```
Trigger → Setup (transform)
                ↓
    ┌───────────┼───────────┐
    ↓           ↓           ↓
  Server    Client    Competitors    ← parallel exploration
  Explorer  Explorer  Analyser
    └───────────┼───────────┘
                ↓
         Pre-Task Meeting (discussion)
                ↓
    ┌───────────┼───────────┐
    ↓           ↓           ↓
  Server     Client    Pre-Task       ← planning with context
  Plan       Plan      Briefing
    └───────────┼───────────┘
                ↓
         Planning Meeting (discussion)
                ↓
         Dev Coordination (discussion)
           ↓         ↓
      Server Dev  Client Dev  ←→  Code Reviewer  ←→  Test Writers
                ↓
         Work Summarizer → Teardown & PR (transform)
```
