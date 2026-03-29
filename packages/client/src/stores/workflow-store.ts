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
import type { WorkflowNodeData } from "@openconclave/shared";

type WorkflowState = {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  workflowName: string;
  workflowDescription: string;
  isDirty: boolean;

  onNodesChange: OnNodesChange<Node<WorkflowNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  addNode: (node: Node<WorkflowNodeData>) => void;
  updateNodeData: (id: string, data: Partial<WorkflowNodeData>) => void;
  removeNode: (id: string) => void;
  setWorkflowMeta: (name: string, description: string) => void;
  loadWorkflow: (nodes: Node<WorkflowNodeData>[], edges: Edge[], name: string, description: string) => void;
  reset: () => void;
};

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
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
    set({
      edges: addEdge(
        { ...connection, animated: true, style: { stroke: "oklch(0.65 0.18 260)" } },
        get().edges
      ),
      isDirty: true,
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

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
    set({ nodes, edges, workflowName: name, workflowDescription: description, isDirty: false, selectedNodeId: null });
  },

  reset: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      workflowName: "Untitled Workflow",
      workflowDescription: "",
      isDirty: false,
    });
  },
}));
