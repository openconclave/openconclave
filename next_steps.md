# Next Steps: Checkpointing & Subgraphs

Two features that solve real problems today, not theoretical nice-to-haves.

---

## 1. Checkpointing (Resume from Failure)

### The Problem

The Dev Pipeline costs $14.53 per run. If it fails at node 20 of 25 — say the client tester hits a flaky test — the entire $7+ of completed server track work is lost. Rerun means re-running every agent from scratch, re-paying for every LLM call, re-waiting 30+ minutes.

This also affects:
- Any workflow with expensive agent calls (Opus nodes)
- Long-running workflows that hit rate limits mid-execution
- Server restarts during a run (currently marked "interrupted" with no recovery)
- Network failures to LLM providers

### What Checkpointing Means

After each node completes successfully, save a snapshot:
- Which nodes have completed
- Their outputs (`nodeOutputs` map)
- Agent session states
- Current position in the graph walk
- Run metadata (cost so far, events so far)

On failure, the run is marked "failed at node X" instead of just "failed." A "Resume" button in the UI (and `resume_run` MCP tool) restarts execution from the last successful checkpoint, skipping completed nodes and reusing their saved outputs.

### Implementation Plan

#### Phase 1: Checkpoint Storage

```
Table: checkpoints
- id: integer PK
- runId: integer FK → runs
- nodeId: string (the node that just completed)
- nodeOutputs: JSON (serialized Map of all node outputs so far)
- completedNodes: JSON (array of completed node IDs)
- agentSessions: JSON (session IDs/paths for resume)
- createdAt: timestamp
```

After each successful `executeNode()` in `graph-walker.ts`, insert a checkpoint row. This is cheap — one DB write per node, and the data is already in memory.

#### Phase 2: Resume Logic

In `graph-walker.ts`:

```typescript
async function walkGraph(run, workflow, options?: { resumeFromCheckpoint?: number }) {
  let nodeOutputs = new Map();
  let completedNodes = new Set();

  if (options?.resumeFromCheckpoint) {
    const cp = await db.getCheckpoint(options.resumeFromCheckpoint);
    nodeOutputs = deserializeMap(cp.nodeOutputs);
    completedNodes = new Set(cp.completedNodes);
    // Skip to first uncompleted node in topological order
  }

  for (const nodeId of executionOrder) {
    if (completedNodes.has(nodeId)) {
      emit({ type: "node:skipped", runId, nodeId }); // UI shows gray "skipped"
      continue;
    }
    // Normal execution continues from here
  }
}
```

#### Phase 3: UI + MCP

- Run detail page: if run status is "failed", show "Resume from last checkpoint" button
- New MCP tool: `oc_resume_run` with `runId` parameter
- Run detail shows which nodes were skipped (gray) vs re-executed (green)
- Cost tracking: resumed run shows "resumed cost" + "prior cost" = "total cost"

#### Phase 4: Agent Session Resume

For Claude agents using Agent SDK `resume`: save the session ID at checkpoint. On resume, pass it back so the agent continues its conversation rather than starting fresh.

For Ollama/OpenAI agents with JSONL sessions: session files already persist on disk. Just ensure the executor reloads the correct session file path from the checkpoint.

### Edge Cases

- **Condition nodes in loops**: if a condition node was the failure point, resume re-evaluates it. The condition might get different input if an upstream agent was the actual failure — need to re-run the immediate predecessor too, not just the failed node.
- **Merge nodes**: a merge checkpoint must record which inputs have arrived. On resume, only re-run the branch that failed, not all branches.
- **Channel Loop**: if the workflow was waiting for a Channel Loop response when the server crashed, the prompt is lost. Checkpointing should save pending prompts so they can be re-sent on resume.
- **Parallel branches**: if one branch fails and the other succeeded, only re-run the failed branch. The merge node still has the successful branch's output from the checkpoint.

### Cost Savings Estimate

Dev Pipeline: if failure happens at node 20/25, resume saves ~$11 (80% of run cost).
Security Review: if failure happens at merge, resume saves ~$1.00 (65% of run cost).
Any workflow with Opus nodes: Opus costs ~$0.50-1.00 per agent task. Each recovered Opus call saves real money.

---

## 2. Subgraphs (Reusable Node Groups)

### The Problem

The Dev Pipeline has two identical tracks: Server (S.Explorer → S.Practices → S.Security → S.Analysis → S.Planner → S.Developer → S.Reviewer → Review Check → S.Tester → Test Check) and Client (identical structure, different prompts). That's 10 nodes duplicated with the same topology. Changes to the review loop logic require editing both tracks.

This also affects:
- Any workflow pattern that appears in multiple workflows (e.g., "analyze → plan → implement → review" is reusable)
- Teams that build standard patterns and want to share them
- Testing — a subgraph can be tested independently

### What Subgraphs Mean

A subgraph is a saved group of nodes + edges that can be dropped into any workflow as a single node. It has:
- Input ports (what goes in)
- Output ports (what comes out)
- Internal nodes that execute as a group
- Configurable parameters (like which model to use, which tools to enable)

On the canvas, a subgraph appears as a single node with a "expand" button to see inside.

### Implementation Plan

#### Phase 1: Subgraph Definition

```
Table: subgraphs
- id: integer PK
- name: string
- description: string
- toolName: string (auto-generated, unique)
- nodes: JSON (array of node definitions with relative positions)
- edges: JSON (array of internal edges)
- inputs: JSON (array of {name, description} — defines input ports)
- outputs: JSON (array of {name, description} — defines output ports)
- parameters: JSON (array of {name, type, default} — configurable per instance)
- createdAt: timestamp
- updatedAt: timestamp
```

#### Phase 2: Subgraph Node Type

Add `subgraph` to NODE_TYPES. A subgraph node on the canvas:

```json
{
  "id": "server_track",
  "type": "subgraph",
  "data": {
    "label": "Dev Track (Server)",
    "type": "subgraph",
    "config": {
      "subgraphId": 1,
      "parameters": {
        "scope": "packages/server/src/",
        "model": "sonnet",
        "systemPromptPrefix": "You work on the server side..."
      }
    }
  }
}
```

#### Phase 3: Execution

When the graph walker hits a subgraph node:

1. Load the subgraph definition
2. Substitute parameters into node configs (e.g., replace `{{scope}}` in agent prompts)
3. Execute the internal graph as a nested walk (reuse `walkGraph` recursively)
4. Collect outputs from the subgraph's output ports
5. Pass outputs to downstream nodes as normal

Checkpointing integrates naturally — each internal node gets its own checkpoint, so a failure inside a subgraph resumes inside it.

#### Phase 4: UI

- Subgraph library page (`/subgraphs`) — list, create, edit, delete
- Canvas: subgraph node shows as a thick-bordered rectangle with expand/collapse
- Expanded view: shows internal nodes in a nested canvas (read-only in the parent workflow, editable in the subgraph editor)
- "Save selection as subgraph" — select nodes on canvas, right-click, save as subgraph. Auto-detects inputs (edges coming from outside selection) and outputs (edges going to outside selection)
- Parameter editor in node inspector when a subgraph instance is selected

#### Phase 5: MCP + Skill

- Each subgraph becomes a reusable template in `create_workflow` — the skill can reference subgraphs by name
- MCP tools: `list_subgraphs`, `create_subgraph`, `get_subgraph`
- Claude Code can say "create a workflow with two Dev Track subgraphs, one for server and one for client"

### Migration Path

The Dev Pipeline (workflow #14) would become:

```
Trigger → Setup Worktree
  ├──→ Dev Track (Server) [subgraph, scope=server]
  └──→ Dev Track (Client) [subgraph, scope=client]
       ├──→ Merge Results → Teardown & PR → Output
```

From 25 nodes to 7 nodes on the canvas. Same execution, same cost, same results. But now if you improve the review loop logic, both tracks get the improvement automatically.

### Subgraph Examples Beyond Dev Pipeline

- **Review Loop**: Agent → Reviewer → Condition → (fail: back to Agent). Reusable in any workflow that needs iterative refinement.
- **Analysis Fan-Out**: Explorer + Practices + Security → Merge. The "research phase" pattern used in multiple workflows.
- **Telegram Notification**: Format message → Send to Telegram. Wrap as subgraph, drop into any workflow that needs notifications.
- **Security Scan**: Pattern Scanner + Architecture Reviewer → Merge → Risk Classifier. The security review pattern as a reusable module.

---

## Priority

**Checkpointing first.** It solves a problem you have today (wasted money on failed runs) and the implementation is contained — mostly changes to `graph-walker.ts` + one new DB table + a resume button. No UI design required beyond the button.

**Subgraphs second.** Bigger scope, requires UI work (nested canvas, subgraph editor, parameter system), but the payoff is large for any team using the platform. The Dev Pipeline is the forcing function — it proves the need.

---

## Estimated Effort

| Feature | Scope | Estimate |
|---|---|---|
| Checkpoint storage | DB table + write after each node | 2-3 hours |
| Resume logic | graph-walker changes + skip logic | 4-6 hours |
| Resume UI + MCP | button + tool + skipped node display | 2-3 hours |
| Agent session resume | SDK resume + JSONL reload | 2-3 hours |
| **Checkpointing total** | | **~1-2 days** |
| Subgraph definition | DB table + CRUD API | 2-3 hours |
| Subgraph node type | type + executor + nested walk | 4-6 hours |
| Subgraph UI | library page + canvas rendering + expand/collapse | 8-12 hours |
| Save-as-subgraph | selection detection + auto input/output | 4-6 hours |
| Parameter system | substitution + inspector UI | 3-4 hours |
| MCP + Skill | tools + skill update | 2-3 hours |
| **Subgraphs total** | | **~3-5 days** |

Both features could be built by the Dev Pipeline itself, making them self-referential proof points.