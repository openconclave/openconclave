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
  NodeType,
} from "@openconclave/shared";

// ── Edge Colors (by source handle, matching handle dot colors) ─

const HANDLE_STROKE: Record<string, string> = {
  bottom: "oklch(0.65 0.18 200)",     // cyan — top/bottom handles
  "top-out": "oklch(0.65 0.18 200)",  // cyan
  left: "oklch(0.65 0.18 260)",       // blue — left handle
  right: "oklch(0.65 0.15 320)",      // purple — right handle
};
const DEFAULT_STROKE = "oklch(0.65 0.18 200)";

export function edgeStyle(sourceHandle?: string | null) {
  const stroke = HANDLE_STROKE[sourceHandle ?? "bottom"] ?? DEFAULT_STROKE;
  return {
    style: { stroke, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
  };
}

// ── Store Types ──────────────────────────────────────────────

interface WorkflowState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  activeNodeIds: Set<string>;
  workflowName: string;
  workflowDescription: string;
  toolName?: string;
  isDirty: boolean;

  onNodesChange: OnNodesChange<Node<WorkflowNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  setActiveNodes: (ids: Set<string>) => void;
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
}

// ── Store ────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  activeNodeIds: new Set<string>(),
  workflowName: "Untitled Workflow",
  workflowDescription: "",
  isDirty: false,

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
      isDirty: true,
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
      isDirty: true,
    });
  },

  onConnect: (connection) => {
    const { style, markerEnd } = edgeStyle(connection.sourceHandle);
    set({
      edges: addEdge(
        {
          ...connection,
          type: "default",
          animated: false,
          style,
          markerEnd,
        },
        get().edges
      ),
      isDirty: true,
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setActiveNodes: (ids) => set({ activeNodeIds: ids }),

  addNode: (node) => {
    set({ nodes: [...get().nodes, node], isDirty: true });
  },

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
      isDirty: true,
    });
  },

  updateNodeConfig: (id, configUpdate) => {
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n;
        return {
          ...n,
          data: {
            ...n.data,
            config: { ...n.data.config, ...configUpdate },
          },
        };
      }),
      isDirty: true,
    });
  },

  removeNode: (id) => {
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
    set({
      nodes,
      edges,
      workflowName: name,
      workflowDescription: description,
      toolName,
      isDirty: false,
      selectedNodeId: null,
      activeNodeIds: new Set<string>(),
    });
  },

  reset: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      activeNodeIds: new Set<string>(),
      workflowName: "Untitled Workflow",
      workflowDescription: "",
      isDirty: false,
    });
  },
}));
