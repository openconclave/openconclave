import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "@openconclave/shared";
import { useWorkflowStore } from "@/stores/workflow-store";

const nodeColors: Record<string, string> = {
  trigger: "border-node-trigger",
  agent: "border-node-agent",
  condition: "border-node-condition",
  transform: "border-node-transform",
  merge: "border-info",
  prompt: "border-warning",
  output: "border-node-output",
};

const nodeBgDots: Record<string, string> = {
  trigger: "bg-node-trigger",
  agent: "bg-node-agent",
  condition: "bg-node-condition",
  transform: "bg-node-transform",
  merge: "bg-info",
  prompt: "bg-warning",
  output: "bg-node-output",
};

export function BaseNode({
  id,
  data,
  selected,
  icon: Icon,
  children,
  showTargetHandle = true,
  showSourceHandle = true,
  sourceHandles,
}: NodeProps & {
  data: WorkflowNodeData;
  icon: React.ElementType;
  children?: React.ReactNode;
  showTargetHandle?: boolean;
  showSourceHandle?: boolean;
  sourceHandles?: { id: string; label: string; position: number }[];
}) {
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const activeNodeId = useWorkflowStore((s) => s.activeNodeId);
  const isActive = activeNodeId === id;

  return (
    <div
      className={cn(
        "w-[200px] rounded-lg border-2 bg-card transition-all cursor-pointer",
        nodeColors[data.type],
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isActive && "animate-pulse ring-2 ring-warning ring-offset-2 ring-offset-background"
      )}
      onClick={() => setSelectedNode(id)}
    >
      {showTargetHandle && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ left: "50%" }}
          className="!h-3 !w-3 !border-2 !border-border !bg-muted"
        />
      )}

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded",
            nodeBgDots[data.type]
          )}
        >
          <Icon className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-medium truncate">{data.label}</span>
      </div>

      {children && <div className="px-3 py-2 text-xs text-muted-foreground">{children}</div>}

      {showSourceHandle && !sourceHandles && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ left: "50%" }}
          className="!h-3 !w-3 !border-2 !border-border !bg-muted"
        />
      )}

      {sourceHandles?.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-border !bg-muted"
          style={{ left: `${h.position}%` }}
        >
          <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap">
            {h.label}
          </span>
        </Handle>
      ))}
    </div>
  );
}
