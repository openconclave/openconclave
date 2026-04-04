# Discussion Node — Implementation Plan

Based on codebase exploration of server engine, client UI, and shared types.

## Overview

Add a new `discussion` node type — a "round table" where connected agents speak sequentially, each seeing the full transcript. A moderator (code or agent) controls speaker order and exit conditions.

---

## Phase 1: Shared Types & Constants

**Goal:** Make the type system aware of the new node type.

### 1.1 Add to NODE_TYPES constant

**File:** `packages/shared/src/constants.ts` (line 15)

```diff
- export const NODE_TYPES = ["trigger", "agent", "condition", "transform", "merge", "prompt", "output", "file"] as const;
+ export const NODE_TYPES = ["trigger", "agent", "condition", "transform", "merge", "prompt", "output", "file", "discussion"] as const;
```

This auto-updates the `NodeType` union in `packages/shared/src/types/workflow.ts:10` since it derives from `NODE_TYPES`.

### 1.2 Add DiscussionConfig interface

**File:** `packages/shared/src/types/workflow.ts` (after FileConfig, ~line 78)

```typescript
export interface DiscussionModeratorConfig {
  /** "code" = deterministic script, "agent" = LLM-driven */
  type: "code" | "agent";
  /** Embedded node data (stored inline, not as a separate canvas node) */
  node: {
    label: string;
    type: "transform" | "agent";
    config: CodeConfig | AgentConfig;
  };
}

export interface DiscussionToolSchema {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface DiscussionConfig {
  /** Prompt template for participants. Variables: {{agentName}}, {{input}}, {{transcript}}, {{round}} */
  prompt: string;
  /** Embedded moderator node (code or agent) */
  moderator?: DiscussionModeratorConfig;
  /** Filter expression to select which connected agents participate */
  filter?: string;
  /** Optional structured output tool for participants */
  tool?: DiscussionToolSchema;
  /** Safety cap — always stops here */
  maxRounds: number;
}
```

Add to `WorkflowNodeConfig` union (line 92-100):

```diff
  export type WorkflowNodeConfig =
    | TriggerConfig | AgentConfig | ConditionConfig | CodeConfig
-   | MergeConfig | PromptConfig | OutputConfig | FileConfig;
+   | MergeConfig | PromptConfig | OutputConfig | FileConfig | DiscussionConfig;
```

**Key design decision:** The moderator is stored **inline** inside DiscussionConfig as embedded node data — not as a separate node in the workflow's `nodes[]` array. This avoids the complexity of "child nodes" in the graph walker. The moderator is invisible to the graph — only the discussion executor knows about it.

### 1.3 Add Zod validation schema

**File:** `packages/shared/src/schemas/workflow.schema.ts` (after existing schemas)

```typescript
export const discussionConfigSchema = z.object({
  prompt: z.string(),
  moderator: z.object({
    type: z.enum(["code", "agent"]),
    node: z.object({
      label: z.string(),
      type: z.enum(["transform", "agent"]),
      config: z.record(z.unknown()),
    }),
  }).optional(),
  filter: z.string().optional(),
  tool: z.object({
    name: z.string(),
    description: z.string(),
    schema: z.record(z.unknown()),
  }).optional(),
  maxRounds: z.number().int().positive(),
});
```

### 1.4 Export new types

**File:** `packages/shared/src/index.ts` — add exports for `DiscussionConfig`, `DiscussionModeratorConfig`.

---

## Phase 2: Server — Template Renderer

**Goal:** Simple mustache-style template engine used by the discussion executor.

### 2.1 Create template utility

**New file:** `packages/server/src/lib/template.ts`

```typescript
/**
 * Simple {{variable.path}} template renderer.
 * Supports dot notation: {{input.topic}}, {{agentName}}
 * Special: {{transcript}} renders the full transcript string.
 */
export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    let value: unknown = context;
    for (const segment of path.split(".")) {
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[segment];
      } else {
        return "";
      }
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value ?? "");
  });
}
```

No external dependencies. Reuses the pattern from existing code nodes that stringify input.

---

## Phase 3: Server — Discussion Executor

**Goal:** The core execution logic for the discussion node.

### 3.1 Create discussion executor

**New file:** `packages/server/src/engine/nodes/discussion.ts`

This is the largest new file. Key responsibilities:

1. **Resolve participants** from incoming edges (filter to agent nodes only)
2. **Apply filter expression** if configured (reuse `evaluateExpression` from `lib/expression.ts`)
3. **Run the discussion loop:**
   - For each round, determine speaker order
   - For each speaker: render prompt template → invoke agent → append to transcript
   - After each speech (agent moderator) or each round (code moderator): evaluate moderator
4. **Invoke moderator:**
   - Code moderator: call `executeCode()` with `{ responses, transcript, round, input }` as stdin
   - Agent moderator: call `invokeWithTools()` with transcript + the `moderate` tool schema
5. **Parse moderator action:** `call_next`, `call_specific`, or `end_discussion`
6. **Build output:** `{ responses, transcript, moderatorSummary, rounds, exitReason, input }`

**Dependencies (all existing):**
- `executeCode()` from `./code.ts` — for code moderator execution
- `invokeWithTools()` from `../../agent/llm-call.ts` — for agent moderator + structured participant output
- `executeAgent()` from `../agent-executor.ts` — for participant agents (freeform mode)
- `evaluateExpression()` from `../../lib/expression.ts` — for filter expressions
- `getIncomingEdges()` from `../graph.ts` — to find participant agents
- `renderTemplate()` from `../../lib/template.ts` — new, from Phase 2

**Function signature** (must match what `node-executor.ts` switch statement calls):

```typescript
export async function executeDiscussion(
  runId: number,
  nodeId: string,
  node: WorkflowNode,
  nodeMap: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
  nodeOutputs: Map<string, unknown>,
  agentSessions: Map<string, string>,
  workflowContext: string | null,
  input: unknown,
  emit: (event: RunEvent) => void,
  callerCwd?: string,
): Promise<unknown>
```

**Events emitted during execution:**
- `discussion:started` — { participants, moderatorType, maxRounds }
- `discussion:speech` — { agentName, agentId, round, message }
- `discussion:moderator` — { action, nextAgent?, summary? }
- `discussion:completed` — { rounds, exitReason, responseCount }

### 3.2 Register in node executor

**File:** `packages/server/src/engine/node-executor.ts` (line 54-82 switch statement)

```typescript
import { executeDiscussion } from "./nodes/discussion";

// In the switch:
case "discussion":
  output = await executeDiscussion(
    runId, nodeId, node, nodeMap, edges,
    nodeOutputs, agentSessions, workflowContext,
    input, emit, callerCwd,
  );
  break;
```

### 3.3 Adjust graph walker (if needed)

**File:** `packages/server/src/engine/graph-walker.ts`

The discussion node consumes incoming agent edges as "participants", not as data flow. The graph walker currently resolves input from parent node outputs (lines 31-47 in node-executor.ts). 

**Approach:** The discussion executor receives `input` from the normal data-flow edge (e.g., from a trigger or transform). It then separately queries `getIncomingEdges()` to find connected agent nodes. Agent nodes that are participants do NOT need to have executed first — the discussion node invokes them internally.

This means participant agent edges should be treated as **metadata edges** (declaring participation), not data-flow edges. The graph walker needs a small change: when determining if a node is ready to execute, skip edges from agent nodes to discussion nodes.

**Alternative (simpler):** Participants connect via a dedicated handle (e.g., `participants` handle on the left side). Data flows in through the standard top handle. The graph walker already only looks at edges matching specific handles for condition nodes — same pattern.

---

## Phase 4: Client — Theme & Base Node Colors

**Goal:** Visual identity for the discussion node.

### 4.1 Add CSS color variable

**File:** `packages/client/src/styles/globals.css` (line 36, after node-tool)

```css
--color-node-discussion: oklch(0.65 0.15 250);
```

Blue-purple, distinct from existing node colors.

### 4.2 Add to BaseNode color maps

**File:** `packages/client/src/components/editor/nodes/base-node.tsx` (lines 6-34)

Add `discussion` entry to each of the three maps:
- `nodeBorderColors`: `"discussion": "border-node-discussion/60"`
- `nodeAccentColors`: `"discussion": "bg-node-discussion"`
- `nodeGlowColors`: `"discussion": "shadow-[0_0_15px_-3px] shadow-node-discussion/20"`

---

## Phase 5: Client — Discussion Node Component

**Goal:** The canvas node with moderator drop zone.

### 5.1 Create discussion node component

**New file:** `packages/client/src/components/editor/nodes/discussion-node.tsx`

**Does NOT extend BaseNode** — custom layout for the larger size and moderator slot. But reuses BaseNode's color maps and handle patterns.

Key elements:
- **Size:** `w-[260px]` (wider than standard 220px), height auto but minimum ~180px
- **Header:** icon (Users from lucide) + label + participant count subtitle
- **Moderator slot:** bordered zone in the center
  - Empty: dashed border, "Drop moderator here" text
  - Filled (code): small chip with code icon + label + exitWhen preview
  - Filled (agent): small chip with agent icon + label
  - x button to clear
- **Footer:** max rounds badge
- **Handles:**
  - Top: target handle (data input from upstream)
  - Bottom: source handle (output to downstream)
  - Left: target handle labeled "participants" (agent connections)

**Drag-and-drop for moderator slot:**

The moderator drop zone accepts `application/openconclave-node` with type "agent" or "transform". When dropped:
1. Parse the dragged data (type, label, default config)
2. Store it inline in `config.moderator.node` (NOT as a separate canvas node)
3. Update via `updateNodeConfig(nodeId, { moderator: { type, node: { label, type, config } } })`

This is the same pattern as agent nodes accepting tool drops (`application/openconclave-tool`), but for nodes instead.

### 5.2 Register in canvas

**File:** `packages/client/src/components/editor/workflow-canvas.tsx` (lines 28-37)

```typescript
import { DiscussionNode } from "./nodes/discussion-node";

const nodeTypes = {
  // ...existing...
  discussion: DiscussionNode,
};
```

Update auto-layout to use taller height for discussion nodes (lines 50, 64):

```typescript
const height = node.data.type === "discussion" ? 200 : 100;
g.setNode(node.id, { width: 260, height });
```

---

## Phase 6: Client — Node Palette & Inspector

### 6.1 Add to palette

**File:** `packages/client/src/components/editor/node-palette.tsx`

Add to `paletteNodes` array (line 11-26):
```typescript
{
  type: "discussion",
  label: "Discussion",
  icon: Users,
  color: "bg-node-discussion",
  description: "Multi-agent round table",
}
```

Add default config in `getDefaultConfig()` (lines 28-39):
```typescript
case "discussion":
  return {
    prompt: "{{transcript}}\n\nYou are {{agentName}}. Share your perspective.",
    maxRounds: 3,
  };
```

### 6.2 Create inspector fields

**New file:** `packages/client/src/components/editor/inspector/discussion-fields.tsx`

Sections:
1. **Prompt template** — textarea (6 rows, monospace), with helper text listing available variables
2. **Filter** — optional text input, monospace, placeholder: `input.alive[agentId] === true`
3. **Max rounds** — number input
4. **Moderator section** — divider, then:
   - If moderator set: chip with label + type badge + x button
   - If code moderator: inline code editor (same textarea as code-fields.tsx) + runtime dropdown
   - If agent moderator: inline agent config (engine, model, system prompt — reuse agent-fields patterns)
   - If empty: helper text "Drag an Agent or Code node onto this discussion node"
5. **Structured output tool** (collapsible, advanced) — tool name, description, JSON schema editor

### 6.3 Register in inspector

**File:** `packages/client/src/components/editor/node-inspector.tsx` (line 58-84)

```typescript
import { DiscussionFields } from "./inspector/discussion-fields";
import type { DiscussionConfig } from "@openconclave/shared";

// In the conditional rendering:
{data.type === "discussion" && (
  <DiscussionFields nodeId={selectedNode.id} config={data.config as DiscussionConfig} />
)}
```

---

## Phase 7: Integration Testing

### 7.1 Manual test: simple round table

Create a workflow:
- Trigger → Discussion → Output
- Connect 3 agent nodes to Discussion's participant handle
- Drop a Code moderator with `exitWhen: "round >= 1"`
- Run and verify all 3 agents speak, each seeing prior speeches

### 7.2 Manual test: agent moderator

Same setup but drop an Agent node as moderator. Verify:
- Moderator is called after each speech
- `call_specific` correctly targets named agent
- `end_discussion` stops the loop

### 7.3 Manual test: filter expression

Connect 5 agents, set filter to select only 3. Verify only filtered agents speak.

### 7.4 Mafia migration test

Rebuild Day Chat Engine as a Discussion node. Compare output quality with the original Python implementation.

---

## File Change Summary

| File | Change | Phase |
|---|---|---|
| `shared/src/constants.ts:15` | Add `"discussion"` to NODE_TYPES | 1 |
| `shared/src/types/workflow.ts` | Add `DiscussionConfig`, `DiscussionModeratorConfig`, update union | 1 |
| `shared/src/schemas/workflow.schema.ts` | Add `discussionConfigSchema` | 1 |
| `shared/src/index.ts` | Export new types | 1 |
| **`server/src/lib/template.ts`** | **NEW** — mustache-style template renderer | 2 |
| **`server/src/engine/nodes/discussion.ts`** | **NEW** — discussion executor (~200-250 lines) | 3 |
| `server/src/engine/node-executor.ts:54-82` | Add `case "discussion"` to switch | 3 |
| `server/src/engine/graph-walker.ts` | Handle participant edges (metadata, not data-flow) | 3 |
| `client/src/styles/globals.css:36` | Add `--color-node-discussion` | 4 |
| `client/src/components/editor/nodes/base-node.tsx:6-34` | Add discussion to color maps | 4 |
| **`client/src/components/editor/nodes/discussion-node.tsx`** | **NEW** — canvas node with moderator slot (~150-200 lines) | 5 |
| `client/src/components/editor/workflow-canvas.tsx:28-37` | Register DiscussionNode, adjust layout | 5 |
| `client/src/components/editor/node-palette.tsx:11-39` | Add palette entry + default config | 6 |
| **`client/src/components/editor/inspector/discussion-fields.tsx`** | **NEW** — inspector fields (~150-200 lines) | 6 |
| `client/src/components/editor/node-inspector.tsx:58-84` | Add discussion case | 6 |

**New files: 4** | **Modified files: 11** | **Estimated total new code: ~700-900 lines**

---

## Key Design Decisions

### Moderator stored inline, not as canvas node

The moderator's node data (config, label, type) is stored inside `DiscussionConfig.moderator.node`, not as a separate entry in the workflow's `nodes[]` array. This means:
- Graph walker doesn't need to understand "child nodes"
- No new concept of node nesting in the data model
- The moderator is invisible to topological sort
- Simpler serialization — just part of the discussion node's config JSON

Trade-off: can't reuse the same moderator across multiple discussion nodes. Acceptable for v1.

### Participants via dedicated handle, not data-flow edges

Agent nodes connect to a `participants` handle on the left side of the Discussion node. This distinguishes "I'm a participant" from "I'm sending data." The top handle receives data input from upstream (trigger output, transform state, etc.).

This reuses the existing handle system (condition nodes already use `sourceHandle` "true"/"false" for routing).

### Template rendering, not code generation

The prompt is a template with simple variable substitution, not arbitrary code. This keeps it safe (no eval), fast (no subprocess), and editable in the UI textarea. Complex prompt logic can be done in a Code node upstream that shapes the input object.

### Code moderator executes via existing executeCode()

The slotted code moderator is executed using the same `executeCode()` function that transform nodes use. It gets `{ responses, transcript, round, input }` via stdin and must output `{ action, nextAgent?, summary? }`. This means any language (Python, Node, Bash) works as a moderator.

### Agent moderator uses invokeWithTools()

The slotted agent moderator is invoked via the existing `invokeWithTools()` function with the `moderate` tool schema. This ensures structured output and works with all supported engines (Claude, Ollama, OpenAI).
