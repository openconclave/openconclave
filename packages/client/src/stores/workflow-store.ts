import { create } from "zustand";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import type {
  WorkflowNodeData,
  WorkflowNodeConfig,
  TriggerConfig,
} from "@openconclave/shared";

// ── Edge Colors (by source handle, matching handle dot colors) ─

const HANDLE_STROKE: Record<string, string> = {
  bottom: "oklch(0.65 0.18 200)",     // cyan — top/bottom handles
  "top-out": "oklch(0.65 0.18 200)",  // cyan
  left: "oklch(0.65 0.18 260)",       // blue — left handle
  right: "oklch(0.65 0.15 320)",      // purple — right handle
};
const DEFAULT_STROKE = "oklch(0.65 0.18 200)";

export function edgeStyle(sourceHandle?: string | null, bidirectional = false) {
  const stroke = HANDLE_STROKE[sourceHandle ?? "bottom"] ?? DEFAULT_STROKE;
  return {
    style: { stroke, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
    ...(bidirectional && {
      markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
    }),
  };
}

function isChatTrigger(node: Node<WorkflowNodeData>): boolean {
  return node.data.type === "trigger" && (node.data.config as TriggerConfig)?.type === "chat";
}

// ── History (undo/redo) ──────────────────────────────────────

interface Snapshot {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

// ── Store Types ──────────────────────────────────────────────

interface WorkflowState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  activeNodeIds: Set<string>;
  skippedNodeIds: Set<string>;
  workflowName: string;
  workflowDescription: string;
  toolName?: string;
  isDirty: boolean;
  isDraggingTool: boolean;
  openDropdownId: string | null;
  setOpenDropdown: (id: string | null) => void;

  _past: Snapshot[];
  _future: Snapshot[];

  onNodesChange: OnNodesChange<Node<WorkflowNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  setActiveNodes: (ids: Set<string>) => void;
  setSkippedNodes: (ids: Set<string>) => void;
  setDraggingTool: (v: boolean) => void;
  pushHistory: () => void;
  addNode: (node: Node<WorkflowNodeData>) => void;
  updateNodeData: (id: string, data: Partial<WorkflowNodeData>) => void;
  updateNodeConfig: (id: string, config: Partial<WorkflowNodeConfig>) => void;
  removeNode: (id: string) => void;
  setWorkflowMeta: (name: string, description: string) => void;
  loadWorkflow: (
    nodes: Node<WorkflowNodeData>[],
    edges: Edge[],
    name: string,
    description: string,
    toolName?: string
  ) => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
}

// ── Store ────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowState>((set, get) => {

  /** Push current nodes/edges onto the undo stack.
   *  Debounced: rapid calls within 50ms batch into one entry. */
  let pendingSnapshot: Snapshot | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function pushHistory() {
    // Capture the earliest state before any mutations in this batch
    if (!pendingSnapshot) {
      const { nodes, edges } = get();
      pendingSnapshot = { nodes: structuredClone(nodes), edges: structuredClone(edges) };
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!pendingSnapshot) return;
      const { _past } = get();
      const past = _past.length >= MAX_HISTORY ? _past.slice(1) : [..._past];
      past.push(pendingSnapshot);
      set({ _past: past, _future: [] });
      pendingSnapshot = null;
      debounceTimer = null;
    }, 50);
  }

  /** Snapshot captured at drag start, committed at drag end */
  let dragSnapshot: Snapshot | null = null;

  return {
  nodes: [],
  edges: [],
  selectedNodeId: null,
  activeNodeIds: new Set<string>(),
  skippedNodeIds: new Set<string>(),
  workflowName: "Untitled Workflow",
  workflowDescription: "",
  isDirty: false,
  isDraggingTool: false,
  openDropdownId: null,
  _past: [],
  _future: [],

  onNodesChange: (changes) => {
    const hasDragStart = changes.some(
      (c) => c.type === "position" && (c as any).dragging
    );
    const hasDragEnd = changes.some(
      (c) => c.type === "position" && !(c as any).dragging
    );
    const hasRemove = changes.some((c) => c.type === "remove");

    // Capture state at drag start
    if (hasDragStart && !dragSnapshot) {
      const { nodes, edges } = get();
      dragSnapshot = { nodes: structuredClone(nodes), edges: structuredClone(edges) };
    }

    // Commit drag snapshot at drag end
    if (hasDragEnd && dragSnapshot) {
      const { _past } = get();
      const past = _past.length >= MAX_HISTORY ? _past.slice(1) : [..._past];
      past.push(dragSnapshot);
      set({ _past: past, _future: [] });
      dragSnapshot = null;
    }

    if (hasRemove) pushHistory();

    set({
      nodes: applyNodeChanges(changes, get().nodes),
      isDirty: true,
    });
  },

  onEdgesChange: (changes) => {
    const hasRemove = changes.some((c) => c.type === "remove");
    if (hasRemove) pushHistory();

    set({
      edges: applyEdgeChanges(changes, get().edges),
      isDirty: true,
    });
  },

  onConnect: (connection) => {
    pushHistory();
    const sourceNode = get().nodes.find((n) => n.id === connection.source);
    const bidirectional = sourceNode ? isChatTrigger(sourceNode) : false;
    const { style, markerEnd, markerStart } = edgeStyle(connection.sourceHandle, bidirectional);
    set({
      edges: addEdge(
        {
          ...connection,
          type: "rounded",
          animated: false,
          style,
          markerEnd,
          ...(markerStart && { markerStart }),
        },
        get().edges
      ),
      isDirty: true,
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setActiveNodes: (ids) => set({ activeNodeIds: ids }),
  setSkippedNodes: (ids) => set({ skippedNodeIds: ids }),
  setDraggingTool: (v) => set({ isDraggingTool: v }),
  setOpenDropdown: (id) => set({ openDropdownId: id }),

  pushHistory: () => pushHistory(),

  addNode: (node) => {
    pushHistory();
    set({ nodes: [...get().nodes, node], isDirty: true });
  },

  updateNodeData: (id, data) => {
    pushHistory();
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
      isDirty: true,
    });
  },

  updateNodeConfig: (id, configUpdate) => {
    pushHistory();
    const updatedNodes = get().nodes.map((n) => {
      if (n.id !== id) return n;
      return {
        ...n,
        data: {
          ...n.data,
          config: { ...n.data.config, ...configUpdate },
        },
      };
    });
    const updatedNode = updatedNodes.find((n) => n.id === id);
    const updatedEdges = get().edges.map((e) => {
      if (e.source !== id || !updatedNode) return e;
      const bidirectional = isChatTrigger(updatedNode);
      const { style, markerEnd, markerStart } = edgeStyle(e.sourceHandle, bidirectional);
      const restyled = { ...e, style, markerEnd };
      if (markerStart) restyled.markerStart = markerStart;
      else delete restyled.markerStart;
      return restyled;
    });
    set({ nodes: updatedNodes, edges: updatedEdges, isDirty: true });
  },

  removeNode: (id) => {
    pushHistory();
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      isDirty: true,
    });
  },

  setWorkflowMeta: (name, description) => {
    set({ workflowName: name, workflowDescription: description, isDirty: true });
  },

  loadWorkflow: (nodes, edges, name, description, toolName) => {
    // Cancel any pending debounce so a stale snapshot is not committed after load
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    pendingSnapshot = null;
    // Re-apply bidirectional markers for edges from chat triggers
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const styledEdges = edges.map((e) => {
      const sourceNode = nodeMap.get(e.source);
      const bidirectional = sourceNode ? isChatTrigger(sourceNode) : false;
      const { style, markerEnd, markerStart } = edgeStyle(e.sourceHandle, bidirectional);
      return { ...e, type: "rounded", style, markerEnd, ...(markerStart && { markerStart }) };
    });
    // Remap "output" RF type to "sink" to avoid React Flow built-in styles
    const remappedNodes = nodes.map((n) =>
      n.type === "output" ? { ...n, type: "sink" } : n
    );
    set({
      nodes: remappedNodes,
      edges: styledEdges,
      workflowName: name,
      workflowDescription: description,
      toolName,
      isDirty: false,
      selectedNodeId: null,
      activeNodeIds: new Set<string>(),
      skippedNodeIds: new Set<string>(),
    });
  },

  reset: () => {
    // Cancel any pending debounce so a stale snapshot is not committed after reset
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    pendingSnapshot = null;
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      activeNodeIds: new Set<string>(),
      skippedNodeIds: new Set<string>(),
      workflowName: "Untitled Workflow",
      workflowDescription: "",
      isDirty: false,
      _past: [],
      _future: [],
    });
  },

  undo: () => {
    const { _past, nodes, edges } = get();
    if (_past.length === 0) return;
    const prev = _past[_past.length - 1];
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      _past: _past.slice(0, -1),
      _future: [...get()._future, { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      isDirty: true,
    });
  },

  redo: () => {
    const { _future, nodes, edges } = get();
    if (_future.length === 0) return;
    const next = _future[_future.length - 1];
    set({
      nodes: next.nodes,
      edges: next.edges,
      _future: _future.slice(0, -1),
      _past: [...get()._past, { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      isDirty: true,
    });
  },
}});
