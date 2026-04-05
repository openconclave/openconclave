# OpenConclave Workflow Best Practices

A comprehensive guide for creating, managing, and debugging OpenConclave workflows — based on real production experience building and running the Dev Pipeline (workflow #14, run #89).

---

## Table of Contents

1. [Workflow Creation](#1-workflow-creation)
2. [Node Types and Configuration](#2-node-types-and-configuration)
3. [Edge Routing and Handles](#3-edge-routing-and-handles)
4. [Data Flow Between Nodes](#4-data-flow-between-nodes)
5. [Agent Configuration](#5-agent-configuration)
6. [Code/Transform Nodes](#6-codetransform-nodes)
7. [Condition Nodes and Loops](#7-condition-nodes-and-loops)
8. [Merge Nodes](#8-merge-nodes)
9. [Knowledge Base Integration](#9-knowledge-base-integration)
10. [Canvas Layout and Positioning](#10-canvas-layout-and-positioning)
11. [Debugging and Monitoring](#11-debugging-and-monitoring)
12. [Cost Management](#12-cost-management)
13. [Common Pitfalls](#13-common-pitfalls)
14. [Workflow Patterns](#14-workflow-patterns)
15. [API Reference](#15-api-reference)

---

## 1. Workflow Creation

### Via MCP Tools

Use `create_workflow` to create a workflow with all nodes and edges atomically:

```
mcp__plugin_openconclave-dev_openconclave-dev__create_workflow
  name: "My Workflow"
  toolName: "my_workflow"          # MCP tool name for triggering
  description: "What it does"
  nodes: [...]                     # Array of node definitions
  edges: [...]                     # Array of edge definitions
```

### Via REST API

```
POST /api/workflows
Content-Type: application/json

{
  "name": "My Workflow",
  "toolName": "my_workflow",
  "nodes": [...],
  "edges": [...]
}
```

To update an existing workflow's definition (nodes, edges, positions):

```
PUT /api/workflows/:id
Content-Type: application/json

{
  "nodes": [...],    # Full nodes array (top level, NOT nested in "definition")
  "edges": [...]     # Full edges array
}
```

**CRITICAL:** The PUT endpoint spreads the body into `definition`. Send `nodes` and `edges` at the top level of the JSON body, NOT nested inside a `definition` key. This was a bug that cost debugging time in run #89.

### Node Structure

```json
{
  "id": "unique_node_id",
  "type": "agent",
  "position": {"x": 400, "y": 300},
  "data": {
    "label": "My Agent",
    "type": "agent",
    "config": {
      "engine": "claude",
      "model": "sonnet",
      "systemPrompt": "...",
      "maxTurns": 100,
      "maxBudgetUsd": 10
    }
  }
}
```

Note: `type` appears twice — once at the node level (for React Flow) and once inside `data` (for the engine). Both must match.

### Edge Structure

```json
{
  "id": "edge_unique_id",
  "source": "source_node_id",
  "target": "target_node_id",
  "sourceHandle": "bottom"    # Optional: "bottom", "left", "right", "true", "false"
}
```

---

## 2. Node Types and Configuration

### Available Types

| Type | Config Key Fields | Purpose |
|---|---|---|
| `trigger` | `type` ("manual", "channel", "cron", "webhook", "chat", "telegram") | Entry point |
| `agent` | `engine`, `model`, `systemPrompt`, `tools[]`, `maxTurns`, `maxBudgetUsd`, `thinking` | LLM agent |
| `transform` | `runtime` ("python", "node", "bash"), `code` | Run code |
| `condition` | `expression` | Branch logic |
| `merge` | `{}` (empty) | Fan-in, wait for all inputs |
| `prompt` | `description` | Human-in-the-loop |
| `output` | `type` ("log", "claude-code", "telegram"), `config` | Send results |
| `discussion` | `topic`, `maxRounds`, `moderator` (type, code/agent config) | Round-table multi-agent discussion |
| `file` | `path`, `mode` ("read", "write") | File I/O |

### Trigger Types

- `manual` — triggered via API or UI "Run" button
- `channel` — triggered via Claude Code channel (MCP plugin)
- `cron` — scheduled execution
- `webhook` — HTTP webhook endpoint
- `chat` — conversational, maintains session across messages
- `telegram` — Telegram bot trigger

For Claude Code integration, use `channel` trigger type. The payload is passed as `triggerPayload` to the first node.

---

## 3. Edge Routing and Handles

### Source Handles

Each node has multiple source handles (output points):

| Handle | Position | Color | Use |
|---|---|---|---|
| `bottom` (default) | Bottom center | Cyan | Standard data flow |
| `left` | Left side | Blue | Secondary output |
| `right` | Right side | Purple | Tertiary output |
| `top` | Top | Cyan | Back-edges (loops) |

Condition nodes have special handles:
- `true` — taken when expression evaluates to true (position 30%)
- `false` — taken when expression evaluates to false (position 70%)

### Edge Routing Rules

The graph walker routes based on `sourceHandle`:

1. **No sourceHandle** — always followed (default data flow)
2. **`sourceHandle: "true"`** — followed only when condition result is true
3. **`sourceHandle: "false"`** — followed only when condition result is false
4. **`sourceHandle: "left"`, `"right"`** — always followed (visual routing only)

### Problem: "Everything connects to the top"

When all edges use the default bottom→top routing, the canvas looks messy — especially with loops. Use side handles for fan-in and loop-back edges:

```json
// Fan-in to a merge node — use side handles for visual clarity
{"source": "explorer",  "target": "analysis_merge", "sourceHandle": "right"},
{"source": "practices", "target": "analysis_merge", "sourceHandle": "right"},
{"source": "security",  "target": "analysis_merge"}  // bottom (default)
```

---

## 4. Data Flow Between Nodes

### How Input Resolution Works

File: `packages/server/src/engine/node-executor.ts`

1. If `triggeredBy` is set (from condition routing or edge traversal), input = the triggering node's output
2. If multiple incoming edges, inputs are collected into an array
3. If single incoming edge, input = that node's output
4. If no incoming edges, input = undefined

### The Context Loss Problem

**This is the #1 data flow issue in multi-agent workflows.**

When agents are chained sequentially:
```
Agent A → Agent B → Agent C → Agent D
```

Each agent receives ONLY the previous agent's text output. Agent D has no access to Agent A's findings — they were replaced at each hop.

**Problem discovered in run #89:** The `CONTEXT:{...}` JSON line we asked agents to preserve got lost by the time it reached the teardown node. Agents produce natural language and don't reliably preserve structured data.

### Solutions

1. **Use merge nodes** to fan-in multiple agent outputs before a critical node:
   ```
   Explorer  ──→ ┐
   Practices ──→ ├── Merge → Planner (sees ALL three)
   Security  ──→ ┘
   ```

2. **Use transform nodes** as state accumulators between agents — code nodes reliably preserve and merge JSON.

3. **Don't rely on agents to pass through structured data.** Agents summarize, rewrite, and lose context. If you need structured data at the end of a chain, use a code node to extract/inject it.

4. **Side-channel state via environment variables.** Code nodes have access to `OC_WORKFLOW_ID`, `OC_RUN_ID`, `OC_NODE_ID` — use the API to store/retrieve state externally if needed.

### Merge Node Output Format

When a merge node receives inputs from multiple sources, it creates an object keyed by source node labels:

```json
{
  "S.Tester": "...tester output text...",
  "C.Tester": "...tester output text..."
}
```

Downstream nodes receive this object as input. Parse it accordingly.

---

## 5. Agent Configuration

### Required: Explicit Tool Assignment

**Agents do NOT get tools by default.** You must explicitly add tools to each agent's config.

```json
{
  "engine": "claude",
  "model": "sonnet",
  "tools": [
    {"toolType": "builtin", "toolId": "Bash",      "toolName": "Bash"},
    {"toolType": "builtin", "toolId": "Read",      "toolName": "Read"},
    {"toolType": "builtin", "toolId": "Write",     "toolName": "Write"},
    {"toolType": "builtin", "toolId": "Edit",      "toolName": "Edit"},
    {"toolType": "builtin", "toolId": "Glob",      "toolName": "Glob"},
    {"toolType": "builtin", "toolId": "Grep",      "toolName": "Grep"},
    {"toolType": "builtin", "toolId": "WebFetch",  "toolName": "WebFetch"},
    {"toolType": "builtin", "toolId": "WebSearch", "toolName": "WebSearch"}
  ]
}
```

Available builtin tool IDs: `Bash`, `Edit`, `Read`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`.

Available MCP tool IDs: `playwright`, `telegram-voice`, `filesystem`, `fetch`.

Knowledge bases: `{"toolType": "knowledge", "toolId": "<kb_id>", "toolName": "<kb_name>"}`.

### Tool Assignment by Role

Not every agent needs every tool. Assign minimum necessary tools:

| Role | Tools |
|---|---|
| Explorer/Researcher | Bash, Read, Glob, Grep |
| Best Practices / Security | Bash, Read, Glob, Grep, WebSearch, WebFetch |
| Planner | Bash, Read, Glob, Grep, Write |
| Developer | Bash, Read, Write, Edit, Glob, Grep |
| Code Reviewer | Bash, Read, Glob, Grep, WebSearch |
| Tester | Bash, Read, Write, Edit, Glob, Grep |

### Turn Limits

**Problem from run #89:** Agents hit turn limits and produce no output. Each "thinking" chunk, tool call, and response counts as a turn.

Recommended minimums:

| Agent Type | Minimum Turns | Notes |
|---|---|---|
| Explorer | 30 | Lots of file reading |
| Researcher | 30 | Web searches + analysis |
| Security | 50 | Deep code analysis + web search |
| Planner | 30 | Synthesis + writing |
| Developer | 75-100 | Code writing + build verification |
| Reviewer | 30 | Diff reading + review |
| Tester | 50 | Write tests + run them |

**If `thinking: true` is enabled, double the turn count.** Each thinking block costs a turn.

Set `maxTurns: 100` and `maxBudgetUsd: 10` as safe defaults for production workflows. The budget acts as the real safety net.

### Budget Enforcement

The budget (`maxBudgetUsd`) is checked between turns. An agent can slightly exceed the budget on its final turn. Set budgets 20% above your expected cost.

### System Prompt Best Practices

1. **Start with context** — what project, what tech stack
2. **State rules clearly** — behavioral directives before role description
3. **Define input format** — what the agent receives and how to parse it
4. **Define output format** — what the agent must produce
5. **Include scope** — which directories/files to focus on
6. **Keep under 2000 chars** — long prompts waste context window

```
You work on [Project] — [tech stack]. You're in [context].

RULES:
- [behavioral directives]

ROLE: [one-line role description]

INPUT: [what you receive]
TASK:
1. [step 1]
2. [step 2]
...

OUTPUT: [format expectations]
SCOPE: [directory/file scope]
```

### Thinking Mode

Enable `thinking: true` for agents that need complex reasoning (developers, reviewers). Doubles turn cost but improves code quality.

---

## 6. Code/Transform Nodes

### Runtime Options

- `python` — runs via `python3 -u <tempfile>`, data on stdin
- `node` — runs via `bun run --stdin`, data on stdin
- `bash` — runs via `bash -s`, data on stdin

### stdin/stdout Protocol

**Input:** JSON piped to stdin:
```json
{
  "input": <previous_node_output>,
  "context": {
    "workflowId": 14,
    "runId": 89,
    "nodeId": "setup"
  }
}
```

**Output:** Whatever is printed to stdout. Parsed as JSON if possible, otherwise stored as string.

### Environment Variables

Code nodes have access to:
- `INPUT` — JSON-stringified input
- `OC_API_URL` — server URL (e.g., `http://localhost:4000`)
- `OC_WORKFLOW_ID` — current workflow ID
- `OC_RUN_ID` — current run ID
- `OC_NODE_ID` — current node ID

### Windows Path Issue

**Problem from run #89:** Python `subprocess.run()` requires Windows paths (`C:\Users\...`), not Git Bash paths (`/c/Users/...`). Even though the shell is bash, Python's subprocess uses Windows APIs.

```python
# WRONG — NotADirectoryError on Windows
repo = "/c/Users/beine/source/repos/openconclave"

# CORRECT
repo = r"C:\Users\beine\source\repos\openconclave"
```

### Subprocess Output Pollution

**Problem from run #89:** Subprocess stdout mixes with the node's JSON output.

```python
# WRONG — git and bun output pollutes stdout
subprocess.run(["git", "worktree", "add", worktree, "-b", branch], check=True, cwd=repo)
subprocess.run(["bun", "install"], cwd=worktree)

# CORRECT — suppress subprocess output
DEVNULL = subprocess.DEVNULL
subprocess.run(["git", "worktree", "add", worktree, "-b", branch],
               check=True, cwd=repo, stdout=DEVNULL, stderr=DEVNULL)
subprocess.run(["bun", "install"], cwd=worktree,
               timeout=180, stdout=DEVNULL, stderr=DEVNULL)
```

The ONLY thing that should go to stdout is the final `print(json.dumps(...))`.

### Timeout

Default code node timeout: 60 seconds (`DEFAULT_CODE_TIMEOUT_MS`). For long operations (npm install, builds), this may not be enough. Currently not configurable per-node — it's a server constant.

---

## 7. Condition Nodes and Loops

### Expression Syntax

Condition expressions are evaluated via `evaluateExpression()` in `packages/server/src/lib/expression.ts`. The expression receives `input` as the previous node's output.

```javascript
// Simple comparison
input.status === "approved"

// String matching (for agent output)
input.includes("VERDICT:APPROVED")

// Numeric
input.count > 5

// Nested property
input.result.score >= 0.8
```

**Security note:** Expressions use `new Function()` with a character whitelist. No `import`, `require`, `eval`, `fetch`, `process` allowed.

### Agent Output Matching Pattern

Since agents produce text (not structured JSON), use string markers for condition routing:

**Agent system prompt:**
```
End your output with EXACTLY one of:
- VERDICT:APPROVED — code is perfect
- VERDICT:CHANGES_REQUIRED — list issues
```

**Condition expression:**
```javascript
input.includes("VERDICT:APPROVED")
```

This is fragile but works. The agent must include the exact marker string in its output.

### Review/Test Loops

Pattern for Developer ↔ Reviewer loop:

```
Developer → Reviewer → Condition
                          ├── true (APPROVED) → next stage
                          └── false (CHANGES_REQUIRED) → back to Developer
```

The Developer's system prompt must handle both cases:
```
Your input is EITHER:
A) Implementation plan from the planner (first run)
B) Review feedback from code reviewer (fix every issue)
```

**Safety:** The graph walker has `MAX_WORKFLOW_ITERATIONS = 100` to prevent infinite loops. For review loops, the condition expression can also include an iteration counter:

```javascript
input.includes("VERDICT:APPROVED") || input.reviewCount >= 3
```

### Condition Routing

Edges from condition nodes use `sourceHandle`:
```json
{"source": "review_check", "target": "tester",    "sourceHandle": "true"},
{"source": "review_check", "target": "developer", "sourceHandle": "false"}
```

The graph walker in `graph-walker.ts` lines 238-252 checks `__conditionResult` against the sourceHandle to determine which edges to follow.

---

## 8. Merge Nodes

### Purpose

Merge nodes wait for ALL incoming edges to have output, then combine them into a single object.

### Output Format

```json
{
  "Source Node Label 1": <output_from_node_1>,
  "Source Node Label 2": <output_from_node_2>
}
```

Keys are the source node labels (not IDs).

### Fan-in Pattern

Use merge nodes to collect outputs from parallel or sequential agents before a critical node:

```
Explorer  ──right──→ ┐
Practices ──right──→ ├── Analysis Merge → Planner
Security  ──bottom─→ ┘
```

This ensures the Planner sees ALL prior analysis, not just the last agent's output.

### Merge + Parse Pattern

If you need structured data from the merged output, add a transform node after the merge to extract it:

```
Merge → Transform (parse/reshape) → Next Agent
```

### Fan-in Tracking

The graph walker tracks which merge nodes have "fired" (line 95 in graph-walker.ts: `firedMerges` set). A merge node only executes once per run, even if triggered multiple times by different paths converging.

---

## 9. Knowledge Base Integration

### Setup

1. Create a knowledge base via the UI at `/knowledge`
2. Add it to agent tools: `{"toolType": "knowledge", "toolId": "<kb_id>", "toolName": "<kb_name>"}`

### Agent Tools for Knowledge

When a knowledge base is attached, agents get three tools:

| Tool | Purpose |
|---|---|
| `search_knowledge` | Semantic search — find relevant prior documents |
| `knowledge_fetch` | Fetch full document by ID (after search finds it) |
| `knowledge_add` | Save new content to the knowledge base |

### Best Practice: Read-Work-Write Pattern

Add this to every agent's system prompt:

```
KNOWLEDGE BOOK (ID: <id>):

BEFORE you start work:
1. Call search_knowledge with queries relevant to your task
2. If results found, call knowledge_fetch to read full documents
3. Use prior knowledge to avoid duplicating work

AFTER you complete your work:
Save important findings using knowledge_add (knowledge_base_id: <id>).
Save USEFUL, SPECIFIC information:
- File paths + line numbers + what the code does
- Patterns discovered, gotchas found, decisions made and WHY
- Security issues with exact locations
- Code snippets that work or don't work

Use descriptive filenames like: "server-node-executor-patterns.md"
Do NOT save vague summaries.
```

### Knowledge Accumulation Across Runs

The knowledge base persists across runs. Each run's agents add findings that help future runs:
- Explorers skip re-discovering known patterns
- Security agents build on prior vulnerability assessments
- Developers avoid repeating known gotchas

**Cost impact:** Knowledge book search/save adds ~$0.05-0.10 per agent per run, but saves much more by reducing redundant exploration.

---

## 10. Canvas Layout and Positioning

### Grid System

Nodes snap to a 20px grid. Recommended spacing:

- **Vertical (Y):** 140-160px between sequential nodes
- **Horizontal (X):** 500-600px between parallel tracks
- **Center column:** x=400 for shared nodes (trigger, merge, output)
- **Left track:** x=100-150
- **Right track:** x=650-700

### Node Sizes

- Standard nodes: 220px wide, ~100px tall
- Discussion nodes: 260px wide, ~200px tall
- Trigger/Output (rounded): slightly wider padding

### Auto-Layout

The canvas has an auto-layout button using dagre (`@dagrejs/dagre`). It uses:
- `rankdir: "TB"` (top to bottom)
- `nodesep: 60` (horizontal spacing)
- `ranksep: 100` (vertical spacing)

To adjust auto-layout for custom node sizes, modify `workflow-canvas.tsx`:
```typescript
const height = node.data.type === "discussion" ? 200 : 100;
g.setNode(node.id, { width: 220, height });
```

### Updating Positions via API

Positions are part of the node definition. Update via PUT:

```python
# Fetch workflow, modify positions, PUT back
for node in nodes:
    if node["id"] == "my_node":
        node["position"] = {"x": 400, "y": 600}

body = {"nodes": nodes, "edges": edges}
requests.put(f"{api}/workflows/{id}", json=body)
```

---

## 11. Debugging and Monitoring

### Real-Time Monitoring

- **UI:** `http://localhost:5173/runs/<runId>` — shows events, node highlighting
- **WebSocket:** Real-time events via `/ws`
- **API:** `GET /api/runs/<runId>` — full run details with tasks and events

### Checking Run Status

```bash
curl -s http://localhost:4000/api/runs/89 | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('Status:', data['run']['status'])
for t in data['tasks']:
    cost = f\"\${t['costUsd']:.2f}\" if t['costUsd'] else '...'
    print(f\"{t['nodeId']:25s} {t['status']:10s} {cost}\")
"
```

### Event Types

| Event | When |
|---|---|
| `node:started` | Node begins execution |
| `node:completed` | Node finishes successfully |
| `node:failed` | Node throws an error |
| `agent:started` | Agent LLM call begins |
| `agent:output` | Streaming agent output chunk |
| `agent:thinking` | Agent thinking block |
| `agent:completed` | Agent call finishes |
| `discussion:started` | Discussion round table begins |
| `discussion:speech` | Agent speaks in discussion |
| `discussion:moderator` | Moderator makes a decision |
| `discussion:completed` | Discussion ends |

### Dumping Run Data

```python
import json, urllib.request

req = urllib.request.Request("http://localhost:4000/api/runs/89")
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

with open("run-89-full.json", "w") as f:
    json.dump(data, f, indent=2)
```

### Common Failure Modes

| Error | Cause | Fix |
|---|---|---|
| `Reached maximum number of turns (N)` | Agent ran out of turns | Increase `maxTurns` |
| `NotADirectoryError` | Windows path in Python subprocess | Use `r"C:\..."` paths |
| Code node exit 1 | Python/Node/Bash script error | Check stderr in run events |
| `MCP error 23: operation timed out` | API response too large | Use direct curl instead of MCP tool |
| Empty merge output | Source nodes haven't completed | Check edge configuration |
| Condition always takes one branch | Expression doesn't match agent output | Add the exact marker string to agent prompt |

---

## 12. Cost Management

### Cost Breakdown by Agent Type

From run #89 (14 agents, 20 tasks including review loops):

| Agent Type | Cost Range | Notes |
|---|---|---|
| Explorer | $0.44-0.65 | File reading heavy |
| Best Practices | $0.59-0.79 | Web search adds cost |
| Security | $0.60-0.85 | Deep analysis + web search |
| Planner | $0.63-0.83 | Synthesis |
| Developer (1st pass) | $0.85-1.02 | Code writing |
| Developer (review fix) | $0.17-1.02 | Varies by issue count |
| Reviewer | $0.16-0.69 | 1st review costs more than subsequent |
| Tester | $1.94-1.99 | Test writing + execution |

### Total Run Costs

| Workflow Type | Estimated Cost |
|---|---|
| Simple (3-5 agents, no loops) | $2-5 |
| Medium (7-10 agents, 1 loop) | $5-10 |
| Complex (14+ agents, multiple loops) | $10-20 |
| Dev Pipeline full run | $14-18 |

### Cost Optimization

1. **Use Sonnet for most agents.** Opus is 5-10x more expensive with marginal quality improvement for non-coding tasks.
2. **Minimize tools on non-coding agents.** Each tool increases prompt size and turn count.
3. **Knowledge book reduces repeat costs.** First run is expensive; subsequent runs are faster because agents find prior findings.
4. **Review loops are cheap.** Second-pass reviews cost $0.16-0.17 — the reviewer quickly confirms fixes.
5. **Set `thinking: true` only for Developer and Reviewer.** Thinking doubles turn cost.

---

## 13. Common Pitfalls

### Pitfall 1: Agents Without Tools

**Problem:** Agents have no file/web access and produce generic responses.
**Fix:** Always add explicit tool arrays. There are no default tools.

### Pitfall 2: Low Turn Limits

**Problem:** Agents hit turn limits and produce no output — the task status is "failure" with error "Reached maximum number of turns."
**Fix:** Set `maxTurns: 100` as default. Better to have headroom than a failed run.

### Pitfall 3: Context Lost in Agent Chains

**Problem:** Agent C can't see Agent A's findings because Agent B replaced them.
**Fix:** Use merge nodes to fan-in before critical decision points. Don't rely on agents to pass through structured data.

### Pitfall 4: Subprocess Output in Code Nodes

**Problem:** Git, npm, or bun output mixes with the node's JSON output, corrupting downstream parsing.
**Fix:** Always use `stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL` for subprocess calls. Only `print()` the final JSON.

### Pitfall 5: Windows Paths in Python

**Problem:** `NotADirectoryError` when using Git Bash paths (`/c/Users/...`) in Python.
**Fix:** Use raw Windows paths: `r"C:\Users\beine\source\repos\..."`.

### Pitfall 6: Agents Modifying package.json

**Problem:** Developer agents add test dependencies and accidentally remove existing dependencies (e.g., removing `@vitejs/plugin-react`).
**Fix:** Add to developer system prompt: "Do NOT modify package.json or bun.lock. If you need additional dependencies, note them in your output but do not install them."

### Pitfall 7: Test Mock Leakage

**Problem:** Tests pass individually but fail when run together due to shared mocks.
**Fix:** Agent-written tests often use `vi.mock()` at module level. These mocks leak across test files in the same Bun test run. Add `vi.restoreAllMocks()` in `afterEach` or use `--isolate` flag.

### Pitfall 8: Teardown Can't Find Context (FIXED)

**Problem:** The teardown node receives merged agent output (natural language) and can't extract the worktree path. Agents told to "Preserve CONTEXT:{...}" don't reliably do it — LLMs summarize and rewrite.
**Fix:** Use a **marker file**. Setup writes `.oc-active-worktree.json` to the repo root. Teardown reads it. All agents can read it too via `cat C:/path/to/repo/.oc-active-worktree.json`.

```python
# In setup code node:
marker = os.path.join(repo, ".oc-active-worktree.json")
with open(marker, 'w') as mf:
    json.dump({"worktreePath": worktree, "branch": branch, "featureName": feature_name, "repoPath": repo}, mf)

# In teardown code node:
marker = os.path.join(repo, ".oc-active-worktree.json")
if os.path.exists(marker):
    with open(marker) as f:
        ctx = json.load(f)
    wt = ctx["worktreePath"]
    os.remove(marker)  # cleanup
```

**Do NOT use CONTEXT:{...} text propagation.** Agents don't reliably pass structured data through text output.

### Pitfall 9: PUT API Format

**Problem:** `PUT /api/workflows/:id` with `{"definition": {...}}` silently fails to update.
**Fix:** Send `nodes` and `edges` at the top level: `{"nodes": [...], "edges": [...]}`.

### Pitfall 10: Security Agent Overly Cautious

**Problem:** Security agent removes features citing vulnerabilities that already exist in production (e.g., flagging `evaluateExpression()` which is used by condition nodes).
**Fix:** Add to security agent prompt: "Focus on NEW vulnerabilities introduced by this change. Do not flag existing patterns that are already in production unless they directly interact with new code."

### Pitfall 11: Agent Output Format for Conditions

**Problem:** Condition node can't route because the agent's verdict text doesn't match the expression.
**Fix:** Use exact string markers (`VERDICT:APPROVED`) not natural language ("I approve this code"). Agents are unreliable with formatting — the simpler the marker, the more reliable the routing.

### Pitfall 12: CONTEXT:{...} Text Propagation

**Problem:** Asking agents to "Preserve the CONTEXT:{...} JSON line" in their output doesn't work. Agents are LLMs — they summarize, rewrite, and lose structured data. After 3-4 agents in a chain, the CONTEXT line is gone.
**Fix:** Use a marker file (see Pitfall 8) or the OC API to share structured context between nodes. Never rely on agents to pass through data they didn't produce.

---

## 14. Workflow Patterns

### Pattern 1: Sequential Agent Chain

```
Trigger → Agent A → Agent B → Agent C → Output
```

Simple but suffers from context loss. Use for short chains (2-3 agents) or when each agent's output is self-contained.

### Pattern 2: Fan-Out / Fan-In

```
Trigger → Setup
  ├──→ Track A (agents...) → Merge → Teardown → Output
  └──→ Track B (agents...) ──┘
```

Parallel processing with merge. Both tracks run concurrently. Merge waits for ALL inputs.

### Pattern 3: Analysis → Synthesis → Implementation

```
Explorer  ──→ ┐
Practices ──→ ├── Merge → Planner → Developer → Reviewer → Tester
Security  ──→ ┘
```

Multiple analysis agents feed into a single planner that synthesizes everything. Best pattern for complex features.

### Pattern 4: Review Loop

```
Developer → Reviewer → Condition
                         ├── true → next
                         └── false → Developer (loop)
```

Iterative refinement. Reviewer sends back to developer if code isn't good enough. Max iterations enforced by `MAX_WORKFLOW_ITERATIONS` or condition expression.

### Pattern 5: Git Worktree Isolation

```
Trigger → Setup (create worktree) → ... agents work in worktree ... → Teardown (commit, push, PR) → Output
```

For self-modifying workflows (building features for the same project that runs the workflow). Critical to avoid breaking the running instance.

Setup node:
```python
subprocess.run(["git", "worktree", "add", worktree, "-b", branch],
               check=True, cwd=repo, stdout=DEVNULL, stderr=DEVNULL)

# Write marker file for all agents and teardown to find the worktree
marker = os.path.join(repo, ".oc-active-worktree.json")
with open(marker, 'w') as mf:
    json.dump({"worktreePath": worktree, "branch": branch, "featureName": feature_name, "repoPath": repo}, mf)
```

Agent prompts should reference the marker file:
```
cd to worktreePath (run: `cat C:/path/to/repo/.oc-active-worktree.json`)
```

### Pattern 6: Knowledge-Augmented Agents

```
Agent reads KB → Does work → Saves findings to KB → Next agent reads KB
```

Each agent searches the knowledge base first, then saves useful findings. The KB accumulates across runs, making future runs faster and cheaper.

### Pattern 7: Discussion Round Table (Discussion Node)

```
Agent A ──participants──→ Discussion Node → Output
Agent B ──participants──→     (moderator: code or agent)
Agent C ──participants──→
```

Sequential conversation where each agent sees the full transcript. Moderator controls speaker order and exit conditions.

**Handle types are critical:**
- Top handle: `type="target"` (data-flow input)
- Participants handle: `type="target"` (left side, receives participant agents)
- Bottom handle: `type="source"` (data-flow output)

Edges connecting participants MUST have `targetHandle: "participants"`. Without this, the server finds 0 participants and the discussion ends immediately.

**Moderator types:**
- `code` — Python/Node/Bash script receives `{responses, transcript, round, input}` via stdin, returns `{action, nextAgent?, summary?}`
- `agent` — LLM agent with a `moderate` tool (`call_next`, `call_specific`, `end_discussion`). Uses `invokeWithTools()`.

**Moderator summaries appear as `[Moderator] ...` in the transcript**, so participants can see moderator feedback in subsequent rounds.

---

## 15. API Reference

### Workflow Management

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/workflows` | List all workflows |
| `GET` | `/api/workflows/:id` | Get workflow with full definition |
| `POST` | `/api/workflows` | Create workflow |
| `PUT` | `/api/workflows/:id` | Update workflow |
| `DELETE` | `/api/workflows/:id` | Delete workflow (cascades) |

### Run Management

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/workflows/:id/run` | Trigger a run (body: `{payload}`) |
| `GET` | `/api/runs/:id` | Get run details + tasks + events |
| `POST` | `/api/runs/:id/message` | Continue a chat run |
| `POST` | `/api/runs/:id/cancel` | Cancel a running workflow |

### Agent Invocation (from code nodes)

```python
import urllib.request, json

body = {
    "workflowId": int(wf_id),
    "runId": int(run_id),
    "nodeId": agent_node_id,
    "prompt": "Your prompt here",
    "tools": [{"name": "tool_name", "description": "...", "input_schema": {...}}]
}

req = urllib.request.Request(
    f"{api_url}/api/agents/invoke",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())
    # result = { "output": "...", "tool_call": {"name": "...", "input": {...}} }
```

### MCP Tools (Claude Code Channel)

| Tool | Purpose |
|---|---|
| `oc_list_workflows` | List workflows |
| `oc_trigger_workflow` | Start a run |
| `oc_get_run` | Get run details |
| `oc_list_runs` | List recent runs |
| `oc_respond` | Respond to a pending prompt |
| `oc_pending_prompts` | List prompts waiting for response |

### MCP Dev Tools

| Tool | Purpose |
|---|---|
| `create_workflow` | Create workflow with nodes/edges |
| `get_workflow` | Get workflow summary |
| `update_workflow` | Update name/description |
| `get_node` | Get full node details |
| `update_node` | Update node config/edges |
| `add_node` | Add a node with optional edges |
| `list_workflows` | List all workflows |
| `list_runs` | List runs for a workflow |
| `get_run` | Get run details |

---

## Appendix: Run #89 Statistics

The Dev Pipeline (workflow #14) implementing the Discussion Node feature:

| Metric | Value |
|---|---|
| Total nodes | 25 |
| Total edges | 33 |
| Agent tasks executed | 20 (14 unique agents, 6 loop iterations) |
| Total cost | $14.53 |
| Total events | 280 |
| Files modified | 14 |
| New files created | 12 |
| Lines of code added | ~1,044 |
| Tests written | 81 (26 template + 44 discussion + 11 executor) |
| Tests passing | 81/81 (individually) |
| Review loop iterations | Server: 2, Client: 3 |
| Blocking bugs found | 1 (package.json corruption) |
| Non-blocking issues | 1 (test mock leakage) |
| Build status after fix | Client builds, server types check |
