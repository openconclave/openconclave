import { useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  BackgroundVariant,
  ConnectionMode,
  type ReactFlowInstance,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { LayoutGrid } from "lucide-react";

import { useWorkflowStore } from "@/stores/workflow-store";
import { TriggerNode } from "./nodes/trigger-node";
import { AgentNode } from "./nodes/agent-node";
import { ConditionNode } from "./nodes/condition-node";
import { TransformNode } from "./nodes/transform-node";
import { MergeNode } from "./nodes/merge-node";
import { PromptNode } from "./nodes/prompt-node";
import { OutputNode } from "./nodes/output-node";
import { FileNode } from "./nodes/file-node";
import { DiscussionNode } from "./nodes/discussion-node";
import type { WorkflowNodeData, NodeType, TriggerConfig } from "@openconclave/shared";

const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  transform: TransformNode,
  merge: MergeNode,
  prompt: PromptNode,
  output: OutputNode,
  file: FileNode,
  discussion: DiscussionNode,
};

let nodeId = Date.now();

function autoLayout() {
  const { nodes, edges } = useWorkflowStore.getState();
  if (nodes.length === 0) return;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });

  for (const node of nodes) {
    // Discussion nodes are 260×200px; all others are 220×100px.
    // Dagre returns node center — subtract half-dimensions to get top-left.
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
    const pos = g.node(node.id);
    const isDiscussion = node.data.type === "discussion";
    const halfW = isDiscussion ? 130 : 110;
    const halfH = isDiscussion ? 100 : 50;
    return {
      ...node,
      position: {
        x: Math.round((pos.x - halfW) / 20) * 20,
        y: Math.round((pos.y - halfH) / 20) * 20,
      },
    };
  });

  useWorkflowStore.setState({ nodes: layoutedNodes, isDirty: true });
}

export function WorkflowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance<Node<WorkflowNodeData>> | null>(null);

  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/openconclave-node");
      if (!raw) return;

      const { type, label, config } = JSON.parse(raw) as {
        type: NodeType;
        label: string;
        config: unknown;
      };

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds || !reactFlowInstance.current) return;

      const position = reactFlowInstance.current.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      // Snap to grid
      position.x = Math.round(position.x / 20) * 20;
      position.y = Math.round(position.y / 20) * 20;

      // Auto-number labels to ensure uniqueness — read fresh from store
      const currentNodes = useWorkflowStore.getState().nodes;
      const existingLabels = new Set(currentNodes.map((n) => n.data.label));
      let uniqueLabel = label;
      if (existingLabels.has(uniqueLabel)) {
        let counter = 2;
        while (existingLabels.has(`${label} ${counter}`)) counter++;
        uniqueLabel = `${label} ${counter}`;
      }

      const id = `${type}_${++nodeId}`;
      const newNode = {
        id,
        type,
        position,
        data: { label: uniqueLabel, type, config } as WorkflowNodeData,
      };

      addNode(newNode);
    },
    [addNode]
  );

  return (
    <div ref={reactFlowWrapper} className="flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={(connection) => {
          const { edges: currentEdges, nodes: currentNodes } = useWorkflowStore.getState();
          // Prevent duplicate edges between same source and target nodes
          const exists = currentEdges.some(
            (e) => e.source === connection.source && e.target === connection.target
          );
          // Prevent self-connections
          if (exists || connection.source === connection.target) return false;

          // Block Agent → Chat when Chat → Agent already exists (bidirectional covers it)
          const targetNode = currentNodes.find((n) => n.id === connection.target);
          if (targetNode && targetNode.data.type === "trigger" && (targetNode.data.config as TriggerConfig).type === "chat") {
            const reverseExists = currentEdges.some(
              (e) => e.source === connection.target && e.target === connection.source
            );
            if (reverseExists) return false;
          }

          return true;
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        onPaneClick={() => setSelectedNode(null)}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
        deleteKeyCode={["Backspace", "Delete"]}
        defaultEdgeOptions={{
          type: "default",
          animated: false,
          selectable: true,
          style: { stroke: "oklch(0.65 0.18 260)", strokeWidth: 2 },
          markerEnd: { type: "arrowclosed" as any, width: 16, height: 16 },
        }}
      >
        <Panel position="top-right" className="flex gap-2">
          <button
            onClick={() => {
              autoLayout();
              reactFlowInstance.current?.fitView({ padding: 0.2 });
            }}
            className="flex items-center gap-1.5 rounded-md bg-card border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Auto Layout
          </button>
        </Panel>
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="oklch(0.25 0.01 260)"
        />
        <Controls className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor="oklch(0.65 0.18 260)"
          maskColor="oklch(0.13 0.01 260 / 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
