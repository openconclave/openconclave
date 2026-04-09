# Client Architecture

The client is a React SPA built with Vite, using React Flow for the workflow canvas and Zustand for state management. Located in `packages/client/src/`.

## Routing

Routing uses URL pathname parsing directly in `app.tsx` (no router library):

| Route | Page | Description |
|-------|------|-------------|
| `/` | DashboardPage | Stats, active runs, recent outputs |
| `/workflows` | WorkflowsPage | List with mini previews |
| `/workflows/new` | WorkflowEditorPage | Create new workflow |
| `/workflows/:id` | WorkflowEditorPage | Edit existing workflow |
| `/runs` | RunsPage | Paginated run list |
| `/runs/:id` | RunDetailPage | Events grouped by node, cost breakdown |
| `/:toolName/chat` | ChatPage | New chat conversation |
| `/:toolName/chat/:runId` | ChatPage | Continue existing chat |
| `/knowledge` | KnowledgePage | Knowledge base management |
| `/settings` | SettingsPage | Providers, Telegram, Ollama config |
| `/?onboarding` | OnboardingPage | First-run setup wizard |

## Workflow Editor

### Canvas (`workflow-canvas.tsx`)

- **React Flow** (`@xyflow/react`) with custom node types and edge rendering
- **Auto-layout** using Dagre (top-to-bottom, 60px node sep, 100px rank sep)
- **Minimap** with color-coded node indicators
- **Connection mode:** "loose" (allows back-edges for bidirectional flows)
- **Grid snapping** at 20px intervals

### Node Components (`editor/nodes/`)

All nodes extend **BaseNode** (`base-node.tsx`) which provides:
- Inline label editing (contentEditable on click)
- Subtitle dropdown for type selection
- Colored borders/shadows by node type
- Handles: target (top), source (bottom)
- Active/skipped status indicators (pulsing/faded during runs)

Type-specific nodes add their own UI:
- **AgentNode** — Tool chips with drag-drop, engine icon
- **ConditionNode** — Dual source handles ("true" at 30%, "false" at 70%)
- **DiscussionNode** — Larger size (280x200), multi-agent prompt display
- **TriggerNode** — Type selector badges
- **TransformNode** — Code node with runtime badge
- **OutputNode** — Output type indicator
- **PromptNode** — Channel Loop description

### Inspector Panel (`node-inspector.tsx`)

Right-side panel (width: 18rem / `w-72`):

**No node selected** → `WorkflowSettings`:
- Workflow name
- Instructions for Claude (with AutoTextarea + "Improve" button)
- Tool name (if set)

**Node selected** → Type-specific field component:
- `TriggerFields` — Trigger type, working directory, cron, webhook URL
- `AgentFields` — Engine, model, system prompt, tools, knowledge bases, max turns, budget
- `ConditionFields` — Expression editor
- `CodeFields` — Runtime selector, code editor
- `OutputFields` / `PromptFields` — Output type, description
- `DiscussionFields` — Prompt template, max rounds, moderator config
- `FileFields` — File path

### Shared Inspector Components (`inspector/shared.tsx`)

- **`Field`** — Label + children wrapper with consistent styling
- **`AutoTextarea`** — Auto-resizing textarea with expand-to-fullscreen modal button
- **`EditorModal`** — Full-screen editor overlay (React Portal)
- **`INPUT_CLASS`** / **`MONO_INPUT_CLASS`** — Tailwind class constants

### Edge Rendering (`rounded-edge.tsx`)

Custom SVG path with 16px rounded corners. Supports:
- Unidirectional arrows (markerEnd only)
- Bidirectional arrows (markerStart + markerEnd) for chat triggers ↔ agents, agents ↔ prompts
- Color coding by source handle

### Node Palette (`node-palette.tsx`)

Draggable panel for adding nodes. Nodes dragged onto canvas trigger `addNode()` in the store.

### Tool Picker (`tool-picker.tsx`)

UI for connecting tools to agent nodes:
- Builtin tools (Bash, Read, Write, WebFetch)
- MCP servers (search from registry)
- Knowledge bases

## Zustand Store (`workflow-store.ts`)

Single store (`useWorkflowStore`) managing all editor state:

### State
```typescript
{
  nodes: Node<WorkflowNodeData>[]     // React Flow nodes
  edges: Edge[]                        // React Flow edges
  selectedNodeId: string | null
  activeNodeIds: Set<string>           // Currently executing (run tracking)
  skippedNodeIds: Set<string>          // Skipped nodes (run tracking)
  workflowName: string
  workflowDescription: string
  toolName?: string
  isDirty: boolean
  _past: Snapshot[]                    // Undo stack (max 50)
  _future: Snapshot[]                  // Redo stack
}
```

### Key Actions
- `onNodesChange`, `onEdgesChange` — React Flow callbacks; mark dirty; debounced history push
- `onConnect` — Add edge with bidirectional styling
- `addNode`, `removeNode` — CRUD with history
- `updateNodeData`, `updateNodeConfig` — Update node properties
- `loadWorkflow` — Hydrate from API response, remap "output" → "sink" node type
- `undo`, `redo` — Stack-based with 50-entry limit
- `setActiveNodes`, `setSkippedNodes` — Run tracking from WebSocket events

### History System
- Debounced push (50ms) — rapid edits (typing, dragging) batch into one snapshot
- Drag-specific handling — snapshot at drag start, commit at drag end
- Redo stack clears on any new edit

## API Client (`lib/api.ts`)

```typescript
const api = {
  get<T>(path: string): Promise<T>,
  post<T>(path: string, body?: unknown): Promise<T>,
  put<T>(path: string, body?: unknown): Promise<T>,
  delete<T>(path: string): Promise<T>,
}
```

Base path: `/api`. All methods throw on non-OK responses.

## WebSocket Client (`lib/ws.ts`)

Singleton `wsClient` with:
- Auto-reconnect (3-second retry)
- Topic-based pub/sub: `subscribe(topic)`, `on(type, handler)`
- Wildcard handlers: `on("*", handler)` receives all events

## Styling

- **Tailwind CSS** with OKLCH color space
- **Dark theme** — Brown base (`oklch(0.13 0.01 60)`)
- **Fonts** — Inter (sans), JetBrains Mono (mono)
- **Node colors**: Teal (flow), Amber (AI), Violet (logic), Blue (I/O)

## UI Components (`components/ui/`)

- `toast(message, type?)` — Global toast notifications (4s auto-dismiss)
- `confirm(options)` — Modal confirmation dialog
- `MarkdownContent` — Renders Markdown with Tailwind prose styling
