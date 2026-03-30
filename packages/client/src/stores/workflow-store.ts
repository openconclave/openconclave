import { create } from "zustand";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import type {
  WorkflowNodeData,
  WorkflowNodeConfig,
  NodeType,
} from "@openconclave/shared";

// ── Edge Colors ──────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  trigger: "oklch(0.65 0.18 145)",
  agent: "oklch(0.65 0.18 260)",
  condition: "oklch(0.70 0.16 80)",
  transform: "oklch(0.65 0.15 300)",
  merge: "oklch(0.65 0.15 230)",
  prompt: "oklch(0.70 0.16 80)",
  output: "oklch(0.60 0.15 20)",
};

// ── Store Types ──────────────────────────────────────────────

interface WorkflowState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  activeNodeId: string | null;
  workflowName: string;
  workflowDescription: string;
  isDirty: boolean;

  onNodesChange: OnNodesChange<Node<WorkflowNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  setActiveNode: (id: string | null) => void;
  addNode: (node: Node<WorkflowNodeData>) => void;
  updateNodeData: (id: string, data: Partial<WorkflowNodeData>) => void;
  updateNodeConfig: (id: string, config: Partial<WorkflowNodeConfig>) => void;
  removeNode: (id: string) => void;
  setWorkflowMeta: (name: string, description: string) => void;
  loadWorkflow: (
    nodes: Node<WorkflowNodeData>[],
    edges: Edge[],
    name: string,
    description: string
  ) => void;
  reset: () => void;
}

// ── Store ────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  activeNodeId: null,
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
    const HANDLE_COLORS: Record<string, string> = {
      left: "oklch(0.65 0.18 200)",
      center: "oklch(0.65 0.18 260)",
      right: "oklch(0.65 0.15 320)",
    };
    const handleId = connection.sourceHandle ?? "center";
    const stroke = HANDLE_COLORS[handleId] ?? HANDLE_COLORS.center;

    set({
      edges: addEdge(
        {
          ...connection,
          type: "default",
          animated: true,
          style: { stroke, strokeWidth: 2 },
        },
        get().edges
      ),
      isDirty: true,
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setActiveNode: (id) => set({ activeNodeId: id }),

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

  loadWorkflow: (nodes, edges, name, description) => {
    set({
      nodes,
      edges,
      workflowName: name,
      workflowDescription: description,
      isDirty: false,
      selectedNodeId: null,
      activeNodeId: null,
    });
  },

  reset: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      activeNodeId: null,
      workflowName: "Untitled Workflow",
      workflowDescription: "",
      isDirty: false,
    });
  },
}));
