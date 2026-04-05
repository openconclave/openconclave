# Discussion Node — Client Implementation Plan

Based on: Explorer analysis (verified against live code), Best Practices Research, Security Review.

## Deviations from Original Design

| # | Original | This Plan | Reason |
|---|----------|-----------|--------|
| VETO-1 | `filter?: string` in config/schema/inspector | **Removed entirely** | Server-side `evaluateExpression()` uses `new Function()` — analogous to CVE-2026-25049 |
| BUG-1 | `g.setNode(node.id, { width: 260, height })` for all | **Conditional width/height per node type** | Plan applied 260px to every node, breaking all other nodes |
| BUG-2 | autoLayout position offset hardcoded to `pos.x - 110` | **Per-node halfW/halfH offsets** | Dagre returns node center; subtracting wrong half-dimensions mispositions discussion nodes by 20/50px |
| BUG-3 | `onDragLeave: () => setDragOver(false)` | **`[&>*]:pointer-events-none` when dragOver** | Child elements fire spurious dragleave, causing visible flicker in moderator slot |
| SEC | `onDrop` casts `JSON.parse(raw)` with no validation | **Full type guard before `updateNodeConfig`** | Synthetic DragEvents from DevTools/XSS can inject arbitrary code into moderator config |
| UX | Moderator configurable only via DnD | **Inspector-first with DnD as shortcut** | DnD is mouse-only; keyboard/touch users cannot configure moderator |
| UX | All moderator fields visible at once | **Type-select collapses irrelevant sections** | Inspector is 288px; showing all code + agent fields simultaneously is cramped |
| UX | `maxRounds` uncapped input | **`min=1 max=100` with onChange clamp** | Uncapped input creates user-confusing DoS-scale loops |
| SEC | Tool JSON schema textarea with no error handling | **`try/catch` + inline error state** | Uncaught JSON.parse exception crashes the inspector panel |

---

## File Change Order (dependency chain)

```
1. shared/src/constants.ts          — NODE_TYPES extended (unblocks everything)
2. shared/src/types/workflow.ts     — DiscussionConfig interfaces + union
3. shared/src/schemas/workflow.schema.ts — discussionConfigSchema
4. shared/src/index.ts              — exports
5. client/styles/globals.css        — CSS variable
6. client/.../nodes/base-node.tsx   — color maps
7. client/.../nodes/discussion-node.tsx  [NEW]
8. client/.../workflow-canvas.tsx   — registration + autoLayout fix
9. client/.../node-palette.tsx      — palette entry + default config
10. client/.../inspector/discussion-fields.tsx  [NEW]
11. client/.../node-inspector.tsx   — discussion block
```

---

## Phase 1 — Shared Package

### 1.1 `packages/shared/src/constants.ts` — line 15

```diff
- export const NODE_TYPES = ["trigger", "agent", "condition", "transform", "merge", "prompt", "output", "file"] as const;
+ export const NODE_TYPES = ["trigger", "agent", "condition", "transform", "merge", "prompt", "output", "file", "discussion"] as const;
```

`NodeType` union in `types/workflow.ts:10` derives from this via `(typeof NODE_TYPES)[number]` — no other type change needed.

---

### 1.2 `packages/shared/src/types/workflow.ts` — insert after `FileConfig` (line 78), before `ToolConfig`

```typescript
export interface DiscussionModeratorConfig {
  /** "code" = deterministic script, "agent" = LLM-driven moderator */
  type: "code" | "agent";
  /** Embedded node data — stored inline, NOT as a separate canvas node */
  node: {
    label: string;
    type: "transform" | "agent";
    config: CodeConfig | AgentConfig;
  };
}

export interface DiscussionToolSchema {
  name: string;
  description: string;
  /** JSON Schema object for structured participant output */
  schema: Record<string, unknown>;
}

export interface DiscussionConfig {
  /** Prompt template for participants. Variables: {{agentName}}, {{input}}, {{transcript}}, {{round}} */
  prompt: string;
  /** Embedded moderator node (code or agent). Optional — defaults to round-robin with maxRounds cap. */
  moderator?: DiscussionModeratorConfig;
  /** Optional structured output tool for participants */
  tool?: DiscussionToolSchema;
  /** Safety cap — always terminates here regardless of moderator */
  maxRounds: number;
}
```

> **NOTE:** `filter?: string` from the original plan is **intentionally absent**. Do not add it.

Update `WorkflowNodeConfig` union (line 100):

```diff
  export type WorkflowNodeConfig =
    | TriggerConfig | AgentConfig | ConditionConfig | CodeConfig
-   | MergeConfig | PromptConfig | OutputConfig | FileConfig;
+   | MergeConfig | PromptConfig | OutputConfig | FileConfig | DiscussionConfig;
```

---

### 1.3 `packages/shared/src/schemas/workflow.schema.ts` — insert after `outputConfigSchema` (after line 53), before `workflowNodeSchema`

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
  tool: z.object({
    name: z.string(),
    description: z.string(),
    schema: z.record(z.unknown()),
  }).optional(),
  maxRounds: z.number().int().min(1).max(100),
});
```

> **NOTE:** `filter: z.string().optional()` is **intentionally absent**.

---

### 1.4 `packages/shared/src/index.ts` — add to exports

In the type exports block (line 3–25), add after `FileConfig`:
```typescript
  FileConfig,
  DiscussionConfig,
  DiscussionModeratorConfig,
  DiscussionToolSchema,
```

In the schema exports block (line 46–57), add after `outputConfigSchema`:
```typescript
  outputConfigSchema,
  discussionConfigSchema,
```

---

## Phase 2 — CSS Theme Variable

### `packages/client/src/styles/globals.css` — insert at line 37 (between `--color-node-tool` and `--radius-lg`)

```css
  --color-node-tool: oklch(0.65 0.18 200);
  --color-node-discussion: oklch(0.65 0.15 250);    /* ← INSERT HERE */

  --radius-lg: 0.75rem;
```

Blue-purple `hue=250` — visually distinct from all existing nodes (trigger=green, agent=gold, condition=amber, transform=violet-300, output=red-orange, merge/info=blue-230, knowledge=gold-55, tool=cyan-200).

---

## Phase 3 — BaseNode Color Maps

### `packages/client/src/components/editor/nodes/base-node.tsx` — lines 6–34

Add `"discussion"` entry to all three maps. The `"file"` node is absent from these maps (pre-existing gap — do not fix):

```typescript
const nodeBorderColors: Record<string, string> = {
  // ...existing 7 entries...
  discussion: "border-node-discussion/60",   // ← ADD
};

const nodeAccentColors: Record<string, string> = {
  // ...existing 7 entries...
  discussion: "bg-node-discussion",           // ← ADD
};

const nodeGlowColors: Record<string, string> = {
  // ...existing 7 entries...
  discussion: "shadow-[0_0_15px_-3px] shadow-node-discussion/20",  // ← ADD
};
```

---

## Phase 4 — Discussion Canvas Node (NEW FILE)

### `packages/client/src/components/editor/nodes/discussion-node.tsx`

Full implementation. Does **not** extend `BaseNode` — the hardcoded `w-[220px]` at `base-node.tsx:70` would need override. Replicates the shell instead.

**Critical constraints respected:**
- All 3 handles are `type="source"` (codebase convention — `ConnectionMode.Loose` handles any-to-any)
- `e.stopPropagation()` in both `onDragOver` and `onDrop` prevents canvas from also firing
- Full type guard before `updateNodeConfig` (VETO-2 fix)
- `[&>*]:pointer-events-none` while `dragOver` is true (dragleave flicker fix)

```tsx
import { useCallback, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Users, Code, Cpu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useNodeData } from "@/hooks/use-node-data";
import type { DiscussionConfig, AgentConfig, CodeConfig } from "@openconclave/shared";

const handleBase = "!h-3 !w-3 !rounded-full !border-2 !bg-card transition-colors";
const topBottomHandle = "!border-[oklch(0.65_0.15_250)] hover:!bg-[oklch(0.65_0.15_250/0.3)]";
const leftHandle = "!border-[oklch(0.65_0.18_260)] hover:!bg-[oklch(0.65_0.18_260/0.3)]";

export function DiscussionNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as DiscussionConfig;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
  const participantCount = useWorkflowStore(
    useCallback((s) => s.edges.filter((e) => e.target === props.id && e.targetHandle === "participants").length, [props.id])
  );

  const isActive = activeNodeIds.has(props.id);
  const [dragOver, setDragOver] = useState(false);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/openconclave-node")) {
      e.preventDefault();
      e.stopPropagation();             // prevent canvas from handling this drop
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();             // prevent canvas from creating a new node
      setDragOver(false);

      const raw = e.dataTransfer.getData("application/openconclave-node");
      if (!raw) return;

      // ── TYPE GUARD (VETO-2) ────────────────────────────────────
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return; // malformed JSON — reject silently
      }

      if (
        typeof parsed !== "object" || parsed === null ||
        !("type" in parsed) || !("label" in parsed) || !("config" in parsed) ||
        (parsed.type !== "agent" && parsed.type !== "transform") ||
        typeof parsed.label !== "string" || !parsed.label.trim() ||
        typeof parsed.config !== "object" || parsed.config === null
      ) {
        return; // wrong shape or wrong node type
      }

      const { type, label, config: droppedConfig } = parsed as {
        type: "agent" | "transform";
        label: string;
        config: AgentConfig | CodeConfig;
      };

      updateNodeConfig(props.id, {
        moderator: {
          type: type === "transform" ? "code" : "agent",
          node: { label, type, config: droppedConfig },
        },
      });
    },
    [props.id, updateNodeConfig]
  );

  const clearModerator = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      updateNodeConfig(props.id, { moderator: undefined });
    },
    [props.id, updateNodeConfig]
  );

  const subtitle = participantCount > 0
    ? `${participantCount} agent${participantCount === 1 ? "" : "s"}`
    : "no agents connected";

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        // [&>*]:pointer-events-none while dragging prevents child dragleave flicker (BUG-3 fix)
        dragOver && "[&>*]:pointer-events-none"
      )}
    >
      <div
        className={cn(
          "w-[260px] rounded-xl border bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
          "border-node-discussion/60",
          "shadow-[0_0_15px_-3px] shadow-node-discussion/20",
          props.selected && "!border-primary ring-1 ring-primary/30 ring-offset-1 ring-offset-background",
          isActive && "[animation:node-running_1.5s_ease-in-out_infinite] !border-warning"
        )}
        onClick={() => setSelectedNode(props.id)}
      >
        {/* Top handle — data input */}
        <Handle
          type="source"
          id="top"
          position={Position.Top}
          style={{ left: "50%" }}
          className={cn(handleBase, topBottomHandle)}
        />

        {/* Left handle — participants */}
        <Handle
          type="source"
          id="participants"
          position={Position.Left}
          style={{ top: "50%" }}
          className={cn(handleBase, leftHandle)}
        >
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/60 whitespace-nowrap font-medium select-none pointer-events-none">
            agents
          </span>
        </Handle>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 bg-node-discussion">
            <Users className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-semibold truncate block">{data.label}</span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {subtitle}
            </span>
          </div>
        </div>

        {/* Moderator slot */}
        <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          {config.moderator ? (
            <div className="flex items-center gap-1.5">
              {config.moderator.type === "code" ? (
                <Code className="h-3 w-3 shrink-0 text-node-transform" />
              ) : (
                <Cpu className="h-3 w-3 shrink-0 text-node-agent" />
              )}
              <span className="truncate flex-1 text-[10px] font-medium text-foreground/80">
                {config.moderator.node.label}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
                {config.moderator.type}
              </span>
              <button
                onClick={clearModerator}
                className="ml-0.5 rounded-full hover:bg-white/10 p-0.5 shrink-0"
                title="Remove moderator"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ) : dragOver ? (
            <div className="rounded border border-dashed border-node-discussion/60 bg-node-discussion/10 px-2 py-1.5 text-[9px] text-node-discussion text-center">
              Drop as moderator
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/50 text-center py-0.5">
              no moderator · round-robin
            </p>
          )}
        </div>

        {/* Footer — max rounds badge */}
        <div className="border-t border-border/40 px-3 py-1.5 flex items-center justify-end">
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">
            max {config.maxRounds ?? 3} rounds
          </span>
        </div>

        {/* Bottom handle — data output */}
        <Handle
          type="source"
          id="bottom"
          position={Position.Bottom}
          style={{ left: "50%" }}
          className={cn(handleBase, topBottomHandle)}
        />
      </div>
    </div>
  );
}
```

---

## Phase 5 — Workflow Canvas Registration

### `packages/client/src/components/editor/workflow-canvas.tsx`

**5.1 Import** (top of file, after `FileNode` import):
```typescript
import { DiscussionNode } from "./nodes/discussion-node";
```

**5.2 `nodeTypes` map** (line 28–37) — add one entry:
```typescript
const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  transform: TransformNode,
  merge: MergeNode,
  prompt: PromptNode,
  output: OutputNode,
  file: FileNode,
  discussion: DiscussionNode,   // ← ADD
};
```

`nodeTypes` is a module-level `const` — do NOT move it inside the component. This is correct per @xyflow/react performance requirements.

**5.3 `autoLayout` function** — replace lines 49–66 (the `for` loop + `nodes.map`) with the version below. This fixes **BUG-1** (wrong dimensions for dagre) AND **BUG-2** (wrong half-offset in position calculation):

```typescript
  for (const node of nodes) {
    const isDiscussion = node.data.type === "discussion";
    g.setNode(node.id, {
      width: isDiscussion ? 260 : 220,
      height: isDiscussion ? 200 : 100,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const isDiscussion = node.data.type === "discussion";
    const halfW = isDiscussion ? 130 : 110;  // half of 260 vs 220
    const halfH = isDiscussion ? 100 : 50;   // half of 200 vs 100
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: Math.round((pos.x - halfW) / 20) * 20,
        y: Math.round((pos.y - halfH) / 20) * 20,
      },
    };
  });
```

---

## Phase 6 — Node Palette

### `packages/client/src/components/editor/node-palette.tsx`

**6.1 Import** — add `Users` to the lucide-react import at line 2:
```typescript
import {
  Zap, Cpu, GitFork, Code, Combine, MessageCircleQuestion, Send, FileText, BookOpen,
  Terminal, FileEdit, FileSearch, FolderSearch, Search, Globe, Server, ChevronDown, ChevronRight,
  Users,   // ← ADD
} from "lucide-react";
```

**6.2 `paletteNodes` array** (line 25) — append after the `file` entry:
```typescript
  { type: "file", label: "File", icon: FileText, color: "bg-info", description: "Read file as input" },
  { type: "discussion", label: "Discussion", icon: Users, color: "bg-node-discussion", description: "Multi-agent round table" },  // ← ADD
```

**6.3 `getDefaultConfig` function** (line 28–38) — add case before the closing `}`:
```typescript
function getDefaultConfig(type: NodeType) {
  switch (type) {
    case "trigger":    return { type: "manual" };
    case "agent":      return { model: "sonnet" };
    case "condition":  return { expression: "" };
    case "transform":  return { runtime: "python", code: "" };
    case "merge":      return {};
    case "prompt":     return { description: "Ask a question if needed" };
    case "output":     return { type: "log", config: {} };
    case "file":       return { path: "" };
    case "discussion": return {              // ← ADD
      prompt: "{{transcript}}\n\nYou are {{agentName}}. Respond to the discussion so far.",
      maxRounds: 3,
    };
  }
}
```

---

## Phase 7 — Discussion Inspector Fields (NEW FILE)

### `packages/client/src/components/editor/inspector/discussion-fields.tsx`

Design decisions:
- **Inspector-first**: Full moderator configuration available via select, not DnD-only
- **Moderator type select**: "none" | "code" | "agent" — switching type resets config to a sensible default
- **Code moderator**: runtime select + 6-row code textarea (not 10 — panel is 288px)
- **Agent moderator**: engine select + system prompt textarea — minimal, no Ollama status fetching
- **maxRounds**: clamped `min=1 max=100` (SEC-NEW-1 fix)
- **Tool JSON schema**: `try/catch` + inline error display (SEC-NEW-2 fix)
- **Shallow merge**: all nested moderator updates use explicit spread chains

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { cn } from "@/lib/utils";
import type { DiscussionConfig, DiscussionModeratorConfig, CodeConfig, AgentConfig } from "@openconclave/shared";
import { Field, INPUT_CLASS, MONO_INPUT_CLASS } from "./shared";

const CODE_RUNTIMES = ["python", "node", "bash"] as const;

const MODERATOR_CODE_PLACEHOLDER =
  `# Input: { responses, transcript, round, input } via stdin\n` +
  `# Output: { action: "call_next" | "call_specific" | "end_discussion", nextAgent?, summary? }\n` +
  `import sys, json\ndata = json.load(sys.stdin)\nprint(json.dumps({ "action": "end_discussion", "summary": "done" }))`;

function defaultModeratorConfig(type: "code" | "agent"): DiscussionModeratorConfig {
  if (type === "code") {
    return {
      type: "code",
      node: {
        label: "Moderator",
        type: "transform",
        config: { runtime: "python", code: "" } satisfies CodeConfig,
      },
    };
  }
  return {
    type: "agent",
    node: {
      label: "Moderator",
      type: "agent",
      config: { engine: "claude", systemPrompt: "You are a discussion moderator. Decide who speaks next or end the discussion." } satisfies AgentConfig,
    },
  };
}

interface DiscussionFieldsProps {
  nodeId: string;
  config: DiscussionConfig;
}

export function DiscussionFields({ nodeId, config }: DiscussionFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const [toolOpen, setToolOpen] = useState(false);
  const [schemaRaw, setSchemaRaw] = useState<string>(
    config.tool?.schema ? JSON.stringify(config.tool.schema, null, 2) : ""
  );
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // Helper: full config update (top-level fields only — Zustand does shallow merge)
  const update = (c: Partial<DiscussionConfig>) => updateNodeConfig(nodeId, c);

  // ── Moderator type select ──────────────────────────────────────
  const moderatorType = config.moderator?.type ?? "none";

  const handleModeratorTypeChange = (newType: string) => {
    if (newType === "none") {
      update({ moderator: undefined });
    } else if (newType === "code" || newType === "agent") {
      // Preserve existing if same type, reset if switching
      if (config.moderator?.type === newType) return;
      update({ moderator: defaultModeratorConfig(newType) });
    }
  };

  // ── Code moderator field updaters (shallow-merge-safe) ─────────
  const updateCodeRuntime = (runtime: string) => {
    if (!config.moderator) return;
    update({
      moderator: {
        ...config.moderator,
        node: {
          ...config.moderator.node,
          config: { ...(config.moderator.node.config as CodeConfig), runtime: runtime as CodeConfig["runtime"] },
        },
      },
    });
  };

  const updateCodeContent = (code: string) => {
    if (!config.moderator) return;
    update({
      moderator: {
        ...config.moderator,
        node: {
          ...config.moderator.node,
          config: { ...(config.moderator.node.config as CodeConfig), code },
        },
      },
    });
  };

  // ── Agent moderator field updaters ─────────────────────────────
  const updateAgentEngine = (engine: string) => {
    if (!config.moderator) return;
    update({
      moderator: {
        ...config.moderator,
        node: {
          ...config.moderator.node,
          config: { ...(config.moderator.node.config as AgentConfig), engine: engine as AgentConfig["engine"] },
        },
      },
    });
  };

  const updateAgentSystemPrompt = (systemPrompt: string) => {
    if (!config.moderator) return;
    update({
      moderator: {
        ...config.moderator,
        node: {
          ...config.moderator.node,
          config: { ...(config.moderator.node.config as AgentConfig), systemPrompt },
        },
      },
    });
  };

  // ── Tool section handlers ──────────────────────────────────────
  const updateToolName = (name: string) => {
    update({ tool: { ...(config.tool ?? { description: "", schema: {} }), name } });
  };
  const updateToolDescription = (description: string) => {
    update({ tool: { ...(config.tool ?? { name: "", schema: {} }), description } });
  };
  const handleSchemaBlur = () => {
    if (!schemaRaw.trim()) {
      setSchemaError(null);
      update({ tool: config.tool ? { ...config.tool, schema: {} } : undefined });
      return;
    }
    try {
      const schema = JSON.parse(schemaRaw) as Record<string, unknown>;
      setSchemaError(null);
      update({ tool: { ...(config.tool ?? { name: "", description: "" }), schema } });
    } catch {
      setSchemaError("Invalid JSON — schema not saved");
    }
  };

  const codeConfig = config.moderator?.node.config as CodeConfig | undefined;
  const agentConfig = config.moderator?.node.config as AgentConfig | undefined;
  const ToolChevron = toolOpen ? ChevronDown : ChevronRight;

  return (
    <>
      {/* Prompt Template */}
      <Field label="Participant Prompt">
        <textarea
          value={config.prompt ?? ""}
          onChange={(e) => update({ prompt: e.target.value })}
          rows={5}
          spellCheck={false}
          className={`${MONO_INPUT_CLASS} resize-none text-xs leading-relaxed`}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        Variables: <code className="font-mono">{"{{agentName}}"}</code>,{" "}
        <code className="font-mono">{"{{transcript}}"}</code>,{" "}
        <code className="font-mono">{"{{input}}"}</code>,{" "}
        <code className="font-mono">{"{{round}}"}</code>
      </p>

      {/* Max Rounds — SEC-NEW-1: clamped min=1 max=100 */}
      <Field label="Max Rounds">
        <input
          type="number"
          min={1}
          max={100}
          value={config.maxRounds ?? 3}
          onChange={(e) => {
            const val = Math.min(100, Math.max(1, parseInt(e.target.value) || 1));
            update({ maxRounds: val });
          }}
          className={INPUT_CLASS}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        Hard cap. Discussion always stops at this round even if the moderator would continue.
      </p>

      {/* Moderator Section */}
      <div className="border-t border-border/40 pt-3 mt-1">
        <p className="text-xs font-medium mb-2">Moderator</p>

        <Field label="Type">
          <select
            value={moderatorType}
            onChange={(e) => handleModeratorTypeChange(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="none">None (round-robin)</option>
            <option value="code">Code script</option>
            <option value="agent">Agent</option>
          </select>
        </Field>

        {moderatorType === "none" && (
          <p className="text-[10px] text-muted-foreground px-1 mt-1">
            Each agent speaks once per round in connection order. You can also drag an Agent
            or Code node from the palette directly onto the Discussion node on the canvas.
          </p>
        )}

        {moderatorType === "code" && codeConfig && (
          <>
            <Field label="Runtime">
              <select
                value={codeConfig.runtime ?? "python"}
                onChange={(e) => updateCodeRuntime(e.target.value)}
                className={INPUT_CLASS}
              >
                {CODE_RUNTIMES.map((r) => (
                  <option key={r} value={r}>{r === "node" ? "Node.js" : r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </Field>
            <Field label="Code">
              <textarea
                value={codeConfig.code ?? ""}
                onChange={(e) => updateCodeContent(e.target.value)}
                placeholder={MODERATOR_CODE_PLACEHOLDER}
                rows={6}
                spellCheck={false}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono resize-y leading-relaxed"
              />
            </Field>
            <p className="text-[10px] text-muted-foreground px-1">
              Receives <code className="font-mono">{"{ responses, transcript, round, input }"}</code> via
              stdin. Must output <code className="font-mono">{"{ action, nextAgent?, summary? }"}</code>.
            </p>
          </>
        )}

        {moderatorType === "agent" && agentConfig && (
          <>
            <Field label="Engine">
              <select
                value={agentConfig.engine ?? "claude"}
                onChange={(e) => updateAgentEngine(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="claude">Claude Code</option>
                <option value="ollama">Ollama (local)</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </Field>
            <Field label="Instructions">
              <textarea
                value={agentConfig.systemPrompt ?? ""}
                onChange={(e) => updateAgentSystemPrompt(e.target.value)}
                rows={4}
                className={`${INPUT_CLASS} resize-none`}
                placeholder="You are a discussion moderator. Choose who speaks next or end the discussion by calling the moderate tool."
              />
            </Field>
            <p className="text-[10px] text-muted-foreground px-1">
              The moderator agent calls a <code className="font-mono">moderate</code> tool to
              control flow (<code className="font-mono">call_next</code>,{" "}
              <code className="font-mono">call_specific</code>,{" "}
              <code className="font-mono">end_discussion</code>).
            </p>
          </>
        )}
      </div>

      {/* Structured Output Tool — collapsible advanced section */}
      <div className="border-t border-border/40 pt-3 mt-1">
        <button
          onClick={() => setToolOpen(!toolOpen)}
          className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ToolChevron className="h-3.5 w-3.5 shrink-0" />
          Structured Output Tool
          <span className="ml-auto text-[10px] text-muted-foreground/50">optional</span>
        </button>

        {toolOpen && (
          <div className="space-y-3 mt-3">
            <Field label="Tool Name">
              <input
                type="text"
                value={config.tool?.name ?? ""}
                onChange={(e) => updateToolName(e.target.value)}
                placeholder="e.g. respond"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Description">
              <input
                type="text"
                value={config.tool?.description ?? ""}
                onChange={(e) => updateToolDescription(e.target.value)}
                placeholder="Tool description for the agent"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="JSON Schema">
              <textarea
                value={schemaRaw}
                onChange={(e) => {
                  setSchemaRaw(e.target.value);
                  setSchemaError(null); // clear error while typing
                }}
                onBlur={handleSchemaBlur}
                rows={5}
                spellCheck={false}
                placeholder='{\n  "type": "object",\n  "properties": { "response": { "type": "string" } }\n}'
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono resize-y leading-relaxed",
                  schemaError && "border-destructive"
                )}
              />
            </Field>
            {/* SEC-NEW-2: inline JSON parse error display */}
            {schemaError && (
              <p className="text-[10px] text-destructive px-1">{schemaError}</p>
            )}
            <p className="text-[10px] text-muted-foreground px-1">
              When set, agents use this tool to submit structured output instead of plain text.
              Validated on blur — schema is not saved until JSON is valid.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
```

---

## Phase 8 — Node Inspector Registration

### `packages/client/src/components/editor/node-inspector.tsx`

**8.1 Add to imports** — extend the `@openconclave/shared` import block (lines 3–11) and add component import:

```typescript
import type {
  WorkflowNodeData,
  AgentConfig,
  TriggerConfig,
  ConditionConfig,
  CodeConfig,
  PromptConfig,
  OutputConfig,
  DiscussionConfig,   // ← ADD
} from "@openconclave/shared";
```

```typescript
import { DiscussionFields } from "./inspector/discussion-fields";   // ← ADD (after FileFields import)
```

**8.2 Conditional rendering** — add after the `file` block (line 83), before the `<button>` (line 86):

```tsx
        {data.type === "file" && (
          <FileFields nodeId={selectedNode.id} config={data.config as { path: string }} />
        )}
        {data.type === "discussion" && (
          <DiscussionFields nodeId={selectedNode.id} config={data.config as DiscussionConfig} />
        )}

        <button   {/* existing Delete Node button */}
```

---

## State Management Notes

**`updateNodeConfig` is a shallow merge** (`workflow-store.ts:137–151`):
```typescript
config: { ...n.data.config, ...configUpdate }
```

This means:
- `update({ maxRounds: 5 })` — safe, top-level field ✅
- `update({ moderator: undefined })` — safe, clears moderator ✅
- Updating nested `moderator.node.config.*` requires **full spread chain** (implemented in `DiscussionFields` above)

**Pattern for nested moderator updates** (critical — do not simplify):
```typescript
// CORRECT:
update({
  moderator: {
    ...config.moderator!,
    node: {
      ...config.moderator!.node,
      config: { ...(config.moderator!.node.config as CodeConfig), code: newValue },
    },
  },
});

// WRONG — replaces entire moderator:
update({ moderator: { ...config.moderator!, node: { ...config.moderator!.node, config: { code: newValue } } } });
// (this is fine actually — explicit full spread IS correct)

// WRONG — Zustand won't deep merge:
updateNodeConfig(nodeId, { "moderator.node.config.code": newValue });  // does not work
```

---

## Pre-existing Issues — Do Not Touch

| Issue | Location | Notes |
|-------|----------|-------|
| `React.memo()` absent on all nodes | all node files | Don't add to DiscussionNode only — creates inconsistency |
| Zustand Set selector causes all-node re-renders | `base-node.tsx:64-65` | Tech debt, not this PR |
| `Field` label has no `htmlFor`/`id` | `inspector/shared.tsx:10-17` | Pre-existing a11y debt |
| `defaultEdgeOptions` inline JSX object | `workflow-canvas.tsx:178` | New ref on every render, minor perf |
| `file` node absent from all 3 color maps | `base-node.tsx:6-34` | Pre-existing gap, unrelated |
| `agentConfigSchema` missing `providerId`, `openaiModel`, `thinking`, `maxBudgetUsd` | `workflow.schema.ts` | Pre-existing inconsistency |

---

## Security Checklist

| Check | Status | Evidence |
|-------|--------|----------|
| `filter` field | ✅ Removed | Not in `DiscussionConfig`, schema, or `DiscussionFields` |
| `onDrop` type guard | ✅ Implemented | Full object shape + type check before `updateNodeConfig` |
| `maxRounds` clamped | ✅ Implemented | `min=1 max=100` + `Math.min/max` on onChange |
| Tool JSON schema | ✅ Error-handled | `try/catch` + `schemaError` state + inline display |
| `dangerouslySetInnerHTML` | ✅ Zero uses | Not introduced anywhere |
| DnD payload origin | ✅ Safe | `node-palette.tsx` uses only `getDefaultConfig()` hardcoded values |
| Prototype pollution | ✅ N/A | `updateNodeConfig` spread is shallow from safe JSON |

---

## File Summary

| File | Status | Key Change |
|------|--------|------------|
| `shared/src/constants.ts:15` | Modify | Add `"discussion"` to NODE_TYPES |
| `shared/src/types/workflow.ts:78` | Modify | Insert `DiscussionConfig` interfaces; update union at :100 |
| `shared/src/schemas/workflow.schema.ts:53` | Modify | Insert `discussionConfigSchema` |
| `shared/src/index.ts` | Modify | Export new types + schema |
| `client/src/styles/globals.css:37` | Modify | Add `--color-node-discussion` CSS variable |
| `client/.../nodes/base-node.tsx:6-34` | Modify | Add `discussion` to 3 color maps |
| `client/.../nodes/discussion-node.tsx` | **NEW** | Canvas node — custom shell, moderator drop zone, 3 handles |
| `client/.../workflow-canvas.tsx` | Modify | Register DiscussionNode; fix autoLayout dims + offsets |
| `client/.../node-palette.tsx` | Modify | Add Users icon, palette entry, `getDefaultConfig` case |
| `client/.../inspector/discussion-fields.tsx` | **NEW** | Full inspector fields — moderator select, tool schema |
| `client/.../node-inspector.tsx` | Modify | Import DiscussionFields + DiscussionConfig; add block |

**New files: 2 | Modified files: 9 | Total: 11**

CONTEXT:{"worktreePath":"C:\\Users\\beine\\source\\repos\\oc-dev-1775341610","branch":"dev/discussion-node-1775341610","featureName":"discussion-node","repoPath":"C:\\Users\\beine\\source\\repos\\openconclave"}
