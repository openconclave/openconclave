# Checkpointing Feature — Client Implementation Plan

**Worktree:** `oc-dev-1775356118`  
**Branch:** `dev/feature-1775356118`  
**Scope:** Phase 1–2 client prerequisites + Phase 3 UI (full spec, implement when ready)  
**Stack:** React 19 · Tailwind v4 · Zustand v5 · Vite 6

---

## Overview

Phase 1 (DB + write checkpoints) and Phase 2 (graph-walker skip logic) are **server-side only**.
The client has three jobs:

1. **Fix two pre-existing bugs** that block useful error feedback (required before any new feature work)
2. **Extend shared types** so both client and server speak the same contract
3. **Build the Phase 3 UI** — resume button + skipped-node visualization on the canvas

All four changes are independent and can be committed separately.

---

## Change 1 — `packages/client/src/lib/api.ts`
### Fix: Read JSON error body before throwing

**Why first:** Every other change depends on `toast(err.message)` showing a useful string.
Without this fix, all error toasts read `"API error: 400"`. One file, ~6 lines.

**Current (`api.ts:8`):**
```typescript
if (!res.ok) throw new Error(`API error: ${res.status}`);
```

**Replace with:**
```typescript
if (!res.ok) {
  let message = `API error: ${res.status}`;
  try {
    const body = await res.json();
    if (typeof body?.error?.message === "string") message = body.error.message;
    else if (typeof body?.message === "string") message = body.message;
  } catch { /* non-JSON error body — fall through to generic message */ }
  throw new Error(message);
}
```

**Rationale:**
- Benefits every API call in the app — not just resume. Cancel, save, run-trigger all get real error messages.
- The `typeof` check is the runtime guard: generics don't protect at runtime.
- Silent `catch` on the inner JSON parse is correct — some error responses aren't JSON.

---

## Change 2 — `packages/shared/src/types/api.ts`
### Extend: Add `checkpoint?` to `RunDetailResponse`

**Current (`api.ts:23-27`):**
```typescript
export type RunDetailResponse = {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
};
```

**Replace with:**
```typescript
export type CheckpointInfo = {
  /** Node IDs that completed successfully before failure */
  completedNodes: string[];
  /** ISO timestamp of when the checkpoint was written */
  createdAt: string;
};

export type RunDetailResponse = {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
  /** Present when a resumable checkpoint exists for this run */
  checkpoint?: CheckpointInfo | null;
};
```

**Notes:**
- `Run` interface is NOT changed — `hasCheckpoint` does not belong on `Run`. The run list page doesn't need it, and the detail response is the right place.
- `completedNodes: string[]` is the only data the client needs: to decide whether the resume button appears and (future) to grey out already-run nodes in a diff view.
- `| null` is explicit — server may return `null` vs omit the key depending on the ORM. TypeScript consumers should treat both as "no checkpoint".
- `CheckpointInfo` is a named export so `run-detail.tsx` can type-annotate without inline type casting.

---

## Change 3 — `packages/client/src/pages/run-detail.tsx`
### Three sub-changes in one file

#### 3a. Delete the local `RunDetail` type; import `RunDetailResponse`

**Current (`run-detail.tsx:23-27`):**
```typescript
type RunDetail = {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
};
```

**Delete the entire block.** Then update the import at line 6:
```typescript
// Before:
import type { Run, AgentTask, RunEvent } from "@openconclave/shared";

// After:
import type { Run, AgentTask, RunEvent, RunDetailResponse } from "@openconclave/shared";
```

Update the state declaration at line 177:
```typescript
// Before:
const [data, setData] = useState<RunDetail | null>(null);

// After:
const [data, setData] = useState<RunDetailResponse | null>(null);
```

Update the polling fetch at line 213:
```typescript
// Before:
api.get<RunDetail>(`/runs/${runId}`)

// After:
api.get<RunDetailResponse>(`/runs/${runId}`)
```

**Why:** The local type was duplication. It will drift again. `RunDetailResponse` is the source of truth and now has `checkpoint?`. If the local type stays, `data.checkpoint` will be a TypeScript error even after updating the shared type.

#### 3b. Add `handleResume` with `useTransition`

Add `useTransition` to the React import at line 1:
```typescript
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
```

Add `RotateCcw` to the Lucide import at line 7-21:
```typescript
import {
  // ... existing icons ...
  Square,
  RotateCcw,
} from "lucide-react";
```

Add the handler near `handleCancel` (after line 261):
```typescript
const [isResuming, startResumeTransition] = useTransition();

const handleResume = () =>
  startResumeTransition(async () => {
    if (!runId) return;
    try {
      const result = await api.post<{ runId: number }>(`/runs/${runId}/resume`, {});
      if (typeof result.runId !== "number") throw new Error("Invalid server response");
      window.location.href = `/runs/${result.runId}`;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to resume run", "error");
    }
  });
```

**Why `useTransition` and not a plain `async` function (like `handleCancel`):**
- `isPending` stays `true` for the full async duration in React 19 — prevents double-submit
- Keeps the UI responsive (transition is interruptible)
- Provides `aria-busy` signal to screen readers without manual state
- `handleCancel`'s silent `catch {}` is a known bug — don't replicate it

#### 3c. Add the Resume button to the JSX

Insert after the Stop button block (after line 308), still inside the `flex items-center gap-3 mb-4` container:

```tsx
{/* Resume button — shown when run failed AND a checkpoint is available */}
{run.status === "failure" && data.checkpoint != null && (
  <button
    onClick={handleResume}
    disabled={isResuming}
    aria-busy={isResuming}
    aria-disabled={isResuming}
    className={cn(
      "ml-auto inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1 text-xs font-medium text-white transition-colors",
      isResuming ? "opacity-60 cursor-not-allowed" : "hover:bg-info/90"
    )}
  >
    {isResuming ? (
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
    ) : (
      <RotateCcw className="h-3 w-3" aria-hidden="true" />
    )}
    {isResuming ? "Resuming…" : "Resume from checkpoint"}
  </button>
)}
```

**Accessibility notes:**
- `aria-hidden="true"` on both icons — button has visible text label so icons are decorative
- `aria-busy={isResuming}` — screen readers announce the loading state
- `aria-disabled={isResuming}` (not just `disabled`) — keeps the button in tab order for screen readers even while pending
- The existing Stop button at line 301 should get the same `aria-hidden` treatment on its `<Square>` icon — pre-existing gap, fix opportunistically

#### 3d. Add `node:skipped` to event labels and colors

In `eventTypeLabels` (line 116-128):
```typescript
const eventTypeLabels: Record<string, string> = {
  // ... existing entries ...
  "node:skipped": "Skipped (resumed)",
};
```

In `eventTypeColor` (line 130-142):
```typescript
const eventTypeColor: Record<string, string> = {
  // ... existing entries ...
  "node:skipped": "text-muted-foreground",
};
```

**Why:** The WS handler emits `node:skipped` events during a resumed run. Without these entries, the event timeline will show raw event type strings (`"node:skipped"`) and fall back to the default `text-muted-foreground` color anyway — so the color is optional but the label matters.

The group-color logic at lines 519-533 already handles this correctly: a group that only has `node:skipped` events will have `hasCompleted = false` and `hasFailed = false`, so it renders as `border-l-muted-foreground` (grey). No changes needed there.

---

## Change 4 — `packages/client/src/stores/workflow-store.ts`
### Add `skippedNodeIds` to the Zustand store

#### 4a. Extend `WorkflowState` interface (line 46-74)

```typescript
interface WorkflowState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  activeNodeIds: Set<string>;
  skippedNodeIds: Set<string>;   // ← ADD: nodes skipped on resume
  workflowName: string;
  // ... rest unchanged ...

  setActiveNodes: (ids: Set<string>) => void;
  setSkippedNodes: (ids: Set<string>) => void;  // ← ADD
  // ... rest unchanged ...
}
```

#### 4b. Add initial state (line 78-85)

```typescript
export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  activeNodeIds: new Set<string>(),
  skippedNodeIds: new Set<string>(),   // ← ADD
  // ... rest unchanged ...
```

#### 4c. Add the setter (after `setActiveNodes` at line 122)

```typescript
setActiveNodes: (ids) => set({ activeNodeIds: ids }),
setSkippedNodes: (ids) => set({ skippedNodeIds: ids }),  // ← ADD
```

#### 4d. Reset `skippedNodeIds` in `loadWorkflow` and `reset`

In `loadWorkflow` (line 166-185), add to the `set({})` call:
```typescript
set({
  nodes,
  edges: styledEdges,
  workflowName: name,
  workflowDescription: description,
  toolName,
  isDirty: false,
  selectedNodeId: null,
  activeNodeIds: new Set<string>(),
  skippedNodeIds: new Set<string>(),  // ← ADD
});
```

In `reset` (line 187-197):
```typescript
reset: () => {
  set({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    activeNodeIds: new Set<string>(),
    skippedNodeIds: new Set<string>(),  // ← ADD
    workflowName: "Untitled Workflow",
    workflowDescription: "",
    isDirty: false,
  });
},
```

**Zustand v5 critical rule — ALWAYS create a new Set, never mutate in place:**
```typescript
// ✅ Correct — new reference triggers React re-render
setSkippedNodes(new Set([...get().skippedNodeIds, nodeId]));

// ❌ Wrong — same reference, Zustand sees no change, no re-render
get().skippedNodeIds.add(nodeId);
setSkippedNodes(get().skippedNodeIds);
```

---

## Change 5 — `packages/client/src/pages/workflow-editor.tsx`
### Handle `node:skipped` WebSocket events

#### 5a. Import `setSkippedNodes` and add `skippedRef`

At line 25, extend the store selectors:
```typescript
const setActiveNodes = useWorkflowStore((s) => s.setActiveNodes);
const setSkippedNodes = useWorkflowStore((s) => s.setSkippedNodes);  // ← ADD
```

After `activeRef` (line 93), add:
```typescript
const activeRef = useRef(new Set<string>());
const skippedRef = useRef(new Set<string>());  // ← ADD
```

#### 5b. Handle `node:skipped` in the WS event handler (lines 126-138)

```typescript
const off = wsClient.on("*", (data: any) => {
  if (!data?.nodeId || String(data.runId) !== String(activeRunId)) return;
  const active = new Set(activeRef.current);
  if (data.type === "node:started" || data.type === "agent:started") {
    active.add(data.nodeId);
  } else if (data.type === "node:completed" || data.type === "agent:completed") {
    active.delete(data.nodeId);
  } else if (data.type === "node:skipped") {              // ← ADD block
    active.delete(data.nodeId);                           // keep active set clean
    const skipped = new Set(skippedRef.current);
    skipped.add(data.nodeId);
    skippedRef.current = skipped;
    setSkippedNodes(skipped);
  } else {
    return;
  }
  activeRef.current = active;
  setActiveNodes(active);
});
```

#### 5c. Clear `skippedNodeIds` when the run finishes (line 100-104)

In `refreshActiveNodes`, when the run is no longer active:
```typescript
if (d.run.status !== "running" && d.run.status !== "queued") {
  setActiveRunId(null);
  setActiveNodes(new Set());
  setSkippedNodes(new Set());   // ← ADD
  activeRef.current = new Set();
  skippedRef.current = new Set(); // ← ADD
  return;
}
```

#### 5d. Also clear on run ID change (line 118-122)

```typescript
if (!activeRunId) {
  setActiveNodes(new Set());
  setSkippedNodes(new Set());   // ← ADD
  activeRef.current = new Set();
  skippedRef.current = new Set(); // ← ADD
  return;
}
```

**Note on `refreshActiveNodes` sync:** The poll fallback at lines 106-113 rebuilds `activeNodeIds` from events but doesn't track `skippedNodeIds`. For correctness, the event-replay loop should also handle `node:skipped`:
```typescript
for (const e of d.events) {
  if ((e.type === "node:started" || e.type === "agent:started") && e.nodeId) active.add(e.nodeId);
  if ((e.type === "node:completed" || e.type === "agent:completed") && e.nodeId) active.delete(e.nodeId);
  if (e.type === "node:skipped" && e.nodeId) {   // ← ADD
    active.delete(e.nodeId);
    skipped.add(e.nodeId);
  }
}
// After loop:
skippedRef.current = skipped;
setSkippedNodes(skipped);
```
This requires initializing `const skipped = new Set<string>()` before the loop.

---

## Change 6 — `packages/client/src/components/editor/nodes/base-node.tsx`
### Add skipped-node visual state

After line 68:
```typescript
const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
const isActive = activeNodeIds.has(id);
const skippedNodeIds = useWorkflowStore((s) => s.skippedNodeIds);   // ← ADD
const isSkipped = skippedNodeIds.has(id);                           // ← ADD
```

In the `className` at line 72-78, add the skipped state after `isActive`:
```typescript
className={cn(
  "w-[220px] rounded-xl border bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
  nodeBorderColors[data.type],
  nodeGlowColors[data.type],
  selected && "!border-primary ring-1 ring-primary/30 ring-offset-1 ring-offset-background",
  isActive && "[animation:node-running_1.5s_ease-in-out_infinite] !border-warning",
  isSkipped && "opacity-40 !border-muted-foreground grayscale-[0.5]",  // ← ADD
)}
```

**Design rationale:**
- `opacity-40` — visually recedes the node; signals "done, skipped over"
- `!border-muted-foreground` — `!important` required to override the type-specific `nodeBorderColors` class
- `grayscale-[0.5]` — half-desaturates the accent color; node type still recognizable but clearly not active. Tailwind v4 supports arbitrary grayscale values.
- The `!` prefix is valid Tailwind v4 syntax and adds `!important`.

---

## Execution Order

```
1. packages/client/src/lib/api.ts              — fix error body (unblocks all toast feedback)
2. packages/shared/src/types/api.ts            — add CheckpointInfo + checkpoint? field
3. packages/client/src/pages/run-detail.tsx    — delete local type, import RunDetailResponse,
                                                  add handleResume, add Resume button,
                                                  add node:skipped event labels
4. packages/client/src/stores/workflow-store.ts — add skippedNodeIds + setSkippedNodes
5. packages/client/src/pages/workflow-editor.tsx — handle node:skipped WS events
6. packages/client/src/components/editor/nodes/base-node.tsx — isSkipped styling
```

Steps 4–6 are the canvas visualization of skipped nodes (Phase 3 canvas part). They are independent of steps 1–3 and can be done in parallel or deferred.

---

## What NOT to Do

| Temptation | Why Not |
|---|---|
| Add `hasCheckpoint` to `Run` interface | Pollutes the run-list type; detail page is the right scope |
| Add `"failed_with_checkpoint"` to `RUN_STATUSES` | `next_steps.md` is explicit: status stays `"failure"`. The resume button condition is `status === "failure" && checkpoint != null` |
| Add `"interrupted"` to `RUN_STATUSES` | Already rendered in `statusIcon`/`statusBadge` records but NOT in constants — pre-existing inconsistency, don't extend it |
| Adopt TanStack Query for polling | Correct solution, wrong scope — it would fix the stale-closure polling bug but is a full-page refactor |
| Navigate with React Router | Not installed for navigation — `window.location.href` is the established pattern |
| Mutate Zustand Set in place | `get().skippedNodeIds.add(id)` → same reference → no re-render |
| Copy `handleCancel`'s `catch {}` pattern | Silent failure swallows useful error info — `handleResume` should always toast on error |

---

## Pre-existing Issues (Fix Opportunistically)

| Location | Issue | Fix |
|---|---|---|
| `run-detail.tsx:301-307` | `<Square>` icon lacks `aria-hidden` | Add `aria-hidden="true"` to the Stop button's icon |
| `run-detail.tsx:226-228` | Stale closure in polling interval | Use `useRef` to track latest status inside interval |
| `styles/globals.css` | Missing `color-scheme: dark` | Add `:root { color-scheme: dark; }` |

These are not checkpointing bugs but are in files being edited — clean them up as you go.
