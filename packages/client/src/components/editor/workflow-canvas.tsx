import { useCallback, useRef, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  BackgroundVariant,
  ConnectionMode,

  SelectionMode,
  reconnectEdge,
  type ReactFlowInstance,
  type Node,
  type Edge,
  type Connection,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { LayoutGrid } from "lucide-react";

import { useWorkflowStore } from "@/stores/workflow-store";
import { RoundedEdge, CustomConnectionLine, buildMiniMapPath } from "./rounded-edge";
import type { MiniMapNodeProps } from "@xyflow/react";

// Group colors for minimap
const miniMapColors: Record<string, string> = {
  trigger: "oklch(0.65 0.18 170)",
  output: "oklch(0.65 0.18 170)",
  agent: "oklch(0.68 0.14 65)",
  discussion: "oklch(0.68 0.14 65)",
  condition: "oklch(0.65 0.18 290)",
  code: "oklch(0.65 0.18 290)",
  merge: "oklch(0.65 0.18 290)",
  file: "oklch(0.65 0.18 290)",
  prompt: "oklch(0.65 0.18 170)",
};

function MiniMapNode({ x, y, width, height, id }: MiniMapNodeProps) {
  const nodeType = useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data?.type;
  const color = miniMapColors[nodeType ?? ""] ?? "oklch(0.65 0.18 260)";
  const rx = Math.min(width, height) * 0.2;
  return (
    <rect
      x={x} y={y} width={width} height={height}
      rx={rx} ry={rx}
      fill="none" stroke={color} strokeWidth={2} opacity={1}
    />
  );
}
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

const edgeTypes = {
  rounded: RoundedEdge,
};

const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  code: TransformNode,
  merge: MergeNode,
  prompt: PromptNode,
  sink: OutputNode,
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
    // Discussion nodes are 280×200px; all others are 240×80px.
    // Heights must be multiples of 40 so handles align with grid.
    const isDiscussion = node.data.type === "discussion";
    g.setNode(node.id, {
      width: isDiscussion ? 280 : 240,
      height: isDiscussion ? 200 : 80,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const isDiscussion = node.data.type === "discussion";
    const halfW = isDiscussion ? 140 : 120;
    const halfH = isDiscussion ? 100 : 40;
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

const handleToPosition: Record<string, Position> = {
  top: Position.Top, bottom: Position.Bottom,
  left: Position.Left, right: Position.Right,
  participants: Position.Left,
  true: Position.Bottom, false: Position.Bottom,
  full: Position.Bottom, last: Position.Bottom, summary: Position.Bottom,
};

function getHandleXY(node: Node<WorkflowNodeData>, handleId: string | null | undefined): [number, number, Position] {
  const w = node.measured?.width ?? 240;
  const h = node.measured?.height ?? 80;
  const x = node.position.x;
  const y = node.position.y;
  const pos = handleToPosition[handleId ?? "bottom"] ?? Position.Bottom;
  switch (pos) {
    case Position.Top: return [x + w / 2, y, pos];
    case Position.Bottom: return [x + w / 2, y + h, pos];
    case Position.Left: return [x, y + h / 2, pos];
    case Position.Right: return [x + w, y + h / 2, pos];
  }
}

const MINIMAP_POS_KEY = "oc-minimap-pos";

function DraggableMiniMap() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Load saved position or default to bottom-right
  useEffect(() => {
    const saved = localStorage.getItem(MINIMAP_POS_KEY);
    if (saved) {
      try { setPos(JSON.parse(saved)); return; } catch {}
    }
    const wrapper = wrapperRef.current?.closest(".react-flow");
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    setPos({ x: rect.width - 232, y: rect.height - 162 });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the header bar, not from the minimap content
    if (!(e.target as HTMLElement).closest("[data-minimap-header]")) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const wrapper = wrapperRef.current?.closest(".react-flow") as HTMLElement | null;
    if (!wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    const mw = 220, mh = 162; // minimap width + header
    let nx = e.clientX - offset.current.x;
    let ny = e.clientY - offset.current.y;
    nx = Math.max(0, Math.min(nx, bounds.width - mw));
    ny = Math.max(0, Math.min(ny, bounds.height - mh));
    setPos({ x: nx, y: ny });
    e.stopPropagation();
  }, []);

  const onPointerUp = useCallback(() => {
    if (dragging.current) {
      dragging.current = false;
      setPos((p) => { if (p) localStorage.setItem(MINIMAP_POS_KEY, JSON.stringify(p)); return p; });
    }
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="absolute z-[5]"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? "visible" : "hidden" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="rounded-lg border border-border bg-card shadow-lg overflow-hidden" style={{ width: 220 }}>
        <div
          data-minimap-header
          className="flex items-center justify-between px-2 py-1 border-b border-border/50 cursor-grab active:cursor-grabbing select-none"
        >
          <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Mini Map</span>
        </div>
        <div style={{ height: 150 }}>
          <MiniMap
            className="!relative !bg-transparent !border-0 !w-full !h-full !m-0 !shadow-none !rounded-none"
            nodeComponent={MiniMapNode}
            maskColor="transparent"
          />
        </div>
      </div>
      <MiniMapEdges />
    </div>
  );
}

function MiniMapEdges() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  useEffect(() => {
    const svg = document.querySelector(".react-flow__minimap svg");
    if (!svg) return;

    svg.querySelectorAll(".minimap-edge").forEach((el) => el.remove());

    for (const edge of edges) {
      const sn = nodes.find((n) => n.id === edge.source);
      const tn = nodes.find((n) => n.id === edge.target);
      if (!sn || !tn) continue;

      const [sx, sy, sp] = getHandleXY(sn, edge.sourceHandle);
      const [tx, ty, tp] = getHandleXY(tn, edge.targetHandle);
      const d = buildMiniMapPath(sx, sy, sp, tx, ty, tp);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "minimap-edge");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "oklch(0.55 0.10 260)");
      path.setAttribute("stroke-width", "3");

      const mask = svg.querySelector(".react-flow__minimap-mask");
      if (mask) svg.insertBefore(path, mask);
      else svg.appendChild(path);
    }
  }, [nodes, edges]);

  return null;
}

export function WorkflowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance<Node<WorkflowNodeData>> | null>(null);
  const lastClickedNode = useRef<string | null>(null);
  const lastClickedEdge = useRef<string | null>(null);
  const selStart = useRef<{ x: number; y: number } | null>(null);

  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const pushHistory = useWorkflowStore((s) => s.pushHistory);
  const addNode = useWorkflowStore((s) => s.addNode);

  const reconnectSucceeded = useRef(false);

  const onReconnectStart = useCallback(() => {
    reconnectSucceeded.current = false;
  }, []);

  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    reconnectSucceeded.current = true;
    pushHistory();
    const updated = reconnectEdge(oldEdge, newConnection, useWorkflowStore.getState().edges);
    useWorkflowStore.setState({ edges: updated, isDirty: true });
  }, [pushHistory]);

  const onReconnectEnd = useCallback((event: MouseEvent | TouchEvent, edge: Edge, handleType: string) => {
    if (reconnectSucceeded.current) return;

    // React Flow's onReconnect doesn't fire with custom edges —
    // manually check if cursor is over a handle and reconnect
    const clientX = "clientX" in event ? event.clientX : event.changedTouches[0].clientX;
    const clientY = "clientY" in event ? event.clientY : event.changedTouches[0].clientY;
    const els = document.elementsFromPoint(clientX, clientY);
    const handleEl = els.find((e) => e.classList.contains("react-flow__handle")) as HTMLElement | null;

    if (handleEl) {
      const nodeEl = handleEl.closest(".react-flow__node");
      const nodeId = nodeEl?.getAttribute("data-id");
      const handleId = handleEl.dataset.handleid ?? null;

      if (nodeId) {
        const newSource = handleType === "source" ? nodeId : edge.source;
        const newTarget = handleType === "target" ? nodeId : edge.target;
        const newSourceHandle = handleType === "source" ? handleId : edge.sourceHandle;
        const newTargetHandle = handleType === "target" ? handleId : edge.targetHandle;

        // Block self-connections and duplicates
        if (newSource !== newTarget) {
          const currentEdges = useWorkflowStore.getState().edges;
          const isDuplicate = currentEdges.some(
            (e) => e.id !== edge.id && e.source === newSource && e.target === newTarget,
          );
          if (!isDuplicate) {
            pushHistory();
            useWorkflowStore.setState({
              edges: currentEdges.map((e) =>
                e.id === edge.id
                  ? { ...e, source: newSource, target: newTarget, sourceHandle: newSourceHandle, targetHandle: newTargetHandle }
                  : e,
              ),
              isDirty: true,
            });
            return;
          }
        }
      }
    }

    // Dropped in empty space → delete edge
    setTimeout(() => {
      pushHistory();
      useWorkflowStore.setState({
        edges: useWorkflowStore.getState().edges.filter((e) => e.id !== edge.id),
        isDirty: true,
      });
    }, 0);
  }, [pushHistory]);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const zCounterRef = useRef(1);

  const onNodeDragStart = useCallback(() => {}, []);

  const [spaceHeld, setSpaceHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) setSpaceHeld(true);
      if (e.key === "Shift") setShiftHeld(true);

      // Cmd+Z / Ctrl+Z — undo; Cmd+Shift+Z / Ctrl+Shift+Z — redo
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
      if (e.key === "Shift") setShiftHeld(false);
    };
    // Reset modifier keys when window loses/regains focus (keyup missed while away)
    const onBlur = () => { setSpaceHeld(false); setShiftHeld(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [undo, redo]);

  const setDraggingTool = useWorkflowStore((s) => s.setDraggingTool);

  useEffect(() => {
    const onDragEnd = () => setDraggingTool(false);
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [setDraggingTool]);

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

      if (!reactFlowInstance.current) return;

      const position = reactFlowInstance.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
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
      // React Flow has built-in "output" node type with forced styles — use "sink" instead
      const rfType = type === "output" ? "sink" : type;
      const newNode = {
        id,
        type: rfType,
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
        minZoom={0.1}
        maxZoom={4}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        onNodeDragStart={onNodeDragStart}
        connectionLineComponent={CustomConnectionLine}
        isValidConnection={(connection) => {
          const { edges: currentEdges, nodes: currentNodes } = useWorkflowStore.getState();
          // Prevent self-connections
          if (connection.source === connection.target) return false;
          // Prevent duplicate edges (same source+target AND same handles)
          const exists = currentEdges.some(
            (e) => e.source === connection.source && e.target === connection.target
              && e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle
          );
          if (exists) return false;

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
        onNodeClick={(_event, node) => {
          const prev = lastClickedNode.current;
          if (prev === node.id) {
            // Second click on same node — deselect
            setSelectedNode(null);
            setTimeout(() => {
              onNodesChange([{ id: node.id, type: "select", selected: false }]);
            }, 0);
            lastClickedNode.current = null;
          } else {
            setSelectedNode(node.id);
            lastClickedNode.current = node.id;
          }
        }}
        onEdgeClick={(_event, edge) => {
          const prev = lastClickedEdge.current;
          if (prev === edge.id) {
            setTimeout(() => {
              onEdgesChange([{ id: edge.id, type: "select", selected: false }]);
            }, 0);
            lastClickedEdge.current = null;
          } else {
            lastClickedEdge.current = edge.id;
          }
        }}
        onSelectionStart={useCallback((e: React.MouseEvent) => {
          selStart.current = { x: e.clientX, y: e.clientY };
        }, [])}
        onSelectionEnd={useCallback((e: React.MouseEvent) => {
          const start = selStart.current;
          if (!start || !reactFlowWrapper.current) {
            selStart.current = null;
            return;
          }

          const left = Math.min(start.x, e.clientX);
          const top = Math.min(start.y, e.clientY);
          const right = Math.max(start.x, e.clientX);
          const bottom = Math.max(start.y, e.clientY);

          // Only process if it was a real drag (not a click)
          if (right - left < 5 && bottom - top < 5) {
            selStart.current = null;
            return;
          }

          const edgePaths = reactFlowWrapper.current.querySelectorAll(
            '.react-flow__edge path.react-flow__edge-path'
          );
          const toSelect: string[] = [];

          edgePaths.forEach((pathEl) => {
            const pathBounds = pathEl.getBoundingClientRect();
            const overlaps =
              pathBounds.left < right &&
              pathBounds.right > left &&
              pathBounds.top < bottom &&
              pathBounds.bottom > top;
            if (overlaps) {
              const edgeEl = pathEl.closest('.react-flow__edge');
              const edgeId = edgeEl?.getAttribute('data-id');
              if (edgeId) toSelect.push(edgeId);
            }
          });

          if (toSelect.length > 0) {
            onEdgesChange(
              toSelect.map((id) => ({ id, type: "select" as const, selected: true }))
            );
          }
          selStart.current = null;
        }, [onEdgesChange])}
        onPaneClick={() => {
          setSelectedNode(null);
          lastClickedNode.current = null;
          lastClickedEdge.current = null;
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        nodeDragThreshold={0}
        panOnDrag={spaceHeld ? [0, 1] : [1]}
        selectionOnDrag={!spaceHeld}
        selectionMode={SelectionMode.Partial}
        edgesFocusable
        edgesReconnectable
        elevateEdgesOnSelect
        multiSelectionKeyCode="Shift"
        snapToGrid
        snapGrid={[20, 20]}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
        deleteKeyCode={["Backspace", "Delete"]}
        defaultEdgeOptions={{
          type: "rounded",
          animated: false,
          selectable: true,
          style: { stroke: "oklch(0.65 0.18 260)", strokeWidth: 1.5 },
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
          offset={0.5}
          color="oklch(0.25 0.01 260)"
        />
        <Controls className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
        <DraggableMiniMap />
      </ReactFlow>
    </div>
  );
}
