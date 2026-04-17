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
  ConclaveNodeData,
  ConclaveNodeConfig,
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

function isChatTrigger(node: Node<ConclaveNodeData>): boolean {
  return node.data.type === "trigger" && (node.data.config as TriggerConfig)?.type === "chat";
}

function isBidirectional(
  source: Node<ConclaveNodeData>,
  target: Node<ConclaveNodeData>,
): boolean {
  if (isChatTrigger(source)) return true;
  if (source.data.type === "agent" && target.data.type === "prompt") return true;
  if (source.data.type === "prompt" && target.data.type === "agent") return true;
  return false;
}

// ── History (undo/redo) ──────────────────────────────────────

interface Snapshot {
  nodes: Node<ConclaveNodeData>[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

// ── Store Types ──────────────────────────────────────────────

interface ConclaveState {
  nodes: Node<ConclaveNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  activeNodeIds: Set<string>;
  skippedNodeIds: Set<string>;
  conclaveName: string;
  conclaveDescription: string;
  toolName?: string;
  isDirty: boolean;
  isDraggingTool: boolean;
  pendingNodeDrop: { type: string; label: string; config: unknown; screenX: number; screenY: number } | null;
  pendingModeratorDrop: { discussionNodeId: string; type: string; label: string; config: unknown } | null;
  openDropdownId: string | null;
  setOpenDropdown: (id: string | null) => void;

  _past: Snapshot[];
  _future: Snapshot[];

  onNodesChange: OnNodesChange<Node<ConclaveNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  setActiveNodes: (ids: Set<string>) => void;
  setSkippedNodes: (ids: Set<string>) => void;
  setDraggingTool: (v: boolean) => void;
  setPendingNodeDrop: (data: ConclaveState["pendingNodeDrop"]) => void;
  setPendingModeratorDrop: (data: ConclaveState["pendingModeratorDrop"]) => void;
  pushHistory: () => void;
  addNode: (node: Node<ConclaveNodeData>) => void;
  updateNodeData: (id: string, data: Partial<ConclaveNodeData>) => void;
  updateNodeConfig: (id: string, config: Partial<ConclaveNodeConfig>) => void;
  removeNode: (id: string) => void;
  setConclaveMeta: (name: string, description: string) => void;
  loadConclave: (
    nodes: Node<ConclaveNodeData>[],
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

export const useConclaveStore = create<ConclaveState>((set, get) => {

  /** Push current nodes/edges onto the undo stack.
   *  Debounced: rapid calls within 50ms batch into one entry. */
  let pendingSnapshot: Snapshot | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function commitPendingSnapshot() {
    if (!pendingSnapshot) return;
    const { _past } = get();
    const past = _past.length >= MAX_HISTORY ? _past.slice(1) : [..._past];
    past.push(pendingSnapshot);
    set({ _past: past, _future: [] });
    pendingSnapshot = null;
  }

  /** Synchronously commit any pending snapshot and cancel the debounce.
   *  Call before reads of _past (undo/redo) so the most recent action isn't lost. */
  function flushPendingHistory() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    commitPendingSnapshot();
  }

  function pushHistory() {
    // Capture the earliest state before any mutations in this batch
    if (!pendingSnapshot) {
      const { nodes, edges } = get();
      pendingSnapshot = { nodes: structuredClone(nodes), edges: structuredClone(edges) };
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      commitPendingSnapshot();
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
  conclaveName: "Untitled Conclave",
  conclaveDescription: "",
  isDirty: false,
  isDraggingTool: false,
  pendingNodeDrop: null,
  pendingModeratorDrop: null,
  openDropdownId: null,
  _past: [],
  _future: [],

  onNodesChange: (changes) => {
    const hasDragStart = changes.some(
      (c) => c.type === "position" && c.dragging === true
    );
    const hasDragEnd = changes.some(
      (c) => c.type === "position" && c.dragging === false
    );
    const hasRemove = changes.some((c) => c.type === "remove");

    // Capture state at drag start
    if (hasDragStart && !dragSnapshot) {
      const { nodes, edges } = get();
      dragSnapshot = { nodes: structuredClone(nodes), edges: structuredClone(edges) };
    }

    const nextNodes = applyNodeChanges(changes, get().nodes);

    // Commit drag snapshot at drag end, but only if positions actually changed
    if (hasDragEnd && dragSnapshot) {
      const preMap = new Map(dragSnapshot.nodes.map((n) => [n.id, n.position]));
      const moved = nextNodes.some((n) => {
        const p = preMap.get(n.id);
        return !p || p.x !== n.position.x || p.y !== n.position.y;
      });
      if (moved) {
        const { _past } = get();
        const past = _past.length >= MAX_HISTORY ? _past.slice(1) : [..._past];
        past.push(dragSnapshot);
        set({ _past: past, _future: [] });
      }
      dragSnapshot = null;
    }

    if (hasRemove) pushHistory();

    set({
      nodes: nextNodes,
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
    const nodes = get().nodes;
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    const bidirectional = (sourceNode && targetNode) ? isBidirectional(sourceNode, targetNode) : false;
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
  setPendingNodeDrop: (data) => set({ pendingNodeDrop: data }),
  setPendingModeratorDrop: (data) => set({ pendingModeratorDrop: data }),
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
      if (e.source !== id && e.target !== id) return e;
      if (!updatedNode) return e;
      const src = e.source === id ? updatedNode : updatedNodes.find((n) => n.id === e.source);
      const tgt = e.target === id ? updatedNode : updatedNodes.find((n) => n.id === e.target);
      const bidirectional = (src && tgt) ? isBidirectional(src, tgt) : false;
      const { style, markerEnd, markerStart } = edgeStyle(e.sourceHandle, bidirectional);
      const { markerStart: _omit, ...rest } = e;
      const restyled: Edge = { ...rest, style, markerEnd, ...(markerStart ? { markerStart } : {}) };
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

  setConclaveMeta: (name, description) => {
    set({ conclaveName: name, conclaveDescription: description, isDirty: true });
  },

  loadConclave: (nodes, edges, name, description, toolName) => {
    // Cancel any pending debounce so a stale snapshot is not committed after load
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    pendingSnapshot = null;
    dragSnapshot = null;
    // Re-apply bidirectional markers for chat triggers and agent↔prompt connections
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const styledEdges = edges.map((e) => {
      const sourceNode = nodeMap.get(e.source);
      const targetNode = nodeMap.get(e.target);
      const bidirectional = (sourceNode && targetNode) ? isBidirectional(sourceNode, targetNode) : false;
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
      conclaveName: name,
      conclaveDescription: description,
      toolName,
      isDirty: false,
      selectedNodeId: null,
      activeNodeIds: new Set<string>(),
      skippedNodeIds: new Set<string>(),
      _past: [],
      _future: [],
    });
  },

  reset: () => {
    // Cancel any pending debounce so a stale snapshot is not committed after reset
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    pendingSnapshot = null;
    dragSnapshot = null;
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      activeNodeIds: new Set<string>(),
      skippedNodeIds: new Set<string>(),
      conclaveName: "Untitled Conclave",
      conclaveDescription: "",
      isDirty: false,
      _past: [],
      _future: [],
    });
  },

  undo: () => {
    flushPendingHistory();
    const { _past, nodes, edges } = get();
    if (_past.length === 0) return;
    const prev = _past[_past.length - 1]!;
    set({
      nodes: structuredClone(prev.nodes),
      edges: structuredClone(prev.edges),
      _past: _past.slice(0, -1),
      _future: [...get()._future, { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      isDirty: true,
    });
  },

  redo: () => {
    flushPendingHistory();
    const { _future, nodes, edges } = get();
    if (_future.length === 0) return;
    const next = _future[_future.length - 1]!;
    set({
      nodes: structuredClone(next.nodes),
      edges: structuredClone(next.edges),
      _future: _future.slice(0, -1),
      _past: [...get()._past, { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      isDirty: true,
    });
  },
}});
