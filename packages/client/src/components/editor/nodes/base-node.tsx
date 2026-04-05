import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "@openconclave/shared";
import { useWorkflowStore } from "@/stores/workflow-store";

const nodeBorderColors: Record<string, string> = {
  trigger: "border-node-trigger/60",
  agent: "border-node-agent/60",
  condition: "border-node-condition/60",
  transform: "border-node-transform/60",
  merge: "border-info/60",
  prompt: "border-warning/60",
  output: "border-node-output/60",
  discussion: "border-node-discussion/60",
};

const nodeAccentColors: Record<string, string> = {
  trigger: "bg-node-trigger",
  agent: "bg-node-agent",
  condition: "bg-node-condition",
  transform: "bg-node-transform",
  merge: "bg-info",
  prompt: "bg-warning",
  output: "bg-node-output",
  discussion: "bg-node-discussion",
};

const nodeGlowColors: Record<string, string> = {
  trigger: "shadow-[0_0_15px_-3px] shadow-node-trigger/20",
  agent: "shadow-[0_0_15px_-3px] shadow-node-agent/20",
  condition: "shadow-[0_0_15px_-3px] shadow-node-condition/20",
  transform: "shadow-[0_0_15px_-3px] shadow-node-transform/20",
  merge: "shadow-[0_0_15px_-3px] shadow-info/20",
  prompt: "shadow-[0_0_15px_-3px] shadow-warning/20",
  output: "shadow-[0_0_15px_-3px] shadow-node-output/20",
  discussion: "shadow-[0_0_15px_-3px] shadow-node-discussion/20",
};

const handleColors = [
  "!border-[oklch(0.65_0.18_200)] hover:!bg-[oklch(0.65_0.18_200/0.3)]",
  "!border-[oklch(0.65_0.18_260)] hover:!bg-[oklch(0.65_0.18_260/0.3)]",
  "!border-[oklch(0.65_0.15_320)] hover:!bg-[oklch(0.65_0.15_320/0.3)]",
];

const handleBase = "!h-3 !w-3 !rounded-full !border-2 !bg-card transition-colors";

export function BaseNode({
  id,
  data,
  selected,
  icon: Icon,
  children,
  subtitle,
  showTargetHandle = true,
  showSourceHandle = true,
  sourceHandles,
}: NodeProps & {
  data: WorkflowNodeData;
  icon: React.ElementType;
  children?: React.ReactNode;
  subtitle?: string;
  showTargetHandle?: boolean;
  showSourceHandle?: boolean;
  sourceHandles?: { id: string; label: string; position: number }[];
}) {
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
  const isActive = activeNodeIds.has(id);

  return (
    <div
      className={cn(
        "w-[220px] rounded-xl border bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
        nodeBorderColors[data.type],
        nodeGlowColors[data.type],
        selected && "!border-primary ring-1 ring-primary/30 ring-offset-1 ring-offset-background",
        isActive && "[animation:node-running_1.5s_ease-in-out_infinite] !border-warning"
      )}
      onClick={() => setSelectedNode(id)}
    >
      {/* All handles are type="source" — connectionMode="loose" on canvas allows any-to-any */}
      {showTargetHandle && (
        <Handle type="source" id="top" position={Position.Top} style={{ left: "50%" }} className={cn(handleBase, handleColors[0])} />
      )}

      <Handle type="source" id="left" position={Position.Left} style={{ top: "50%" }} className={cn(handleBase, handleColors[1])} />

      <Handle type="source" id="right" position={Position.Right} style={{ top: "50%" }} className={cn(handleBase, handleColors[2])} />

      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
            nodeAccentColors[data.type]
          )}
        >
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold truncate block">{data.label}</span>
          {subtitle && (
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{subtitle}</span>
          )}
        </div>
      </div>

      {/* Content */}
      {children && (
        <div className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          {children}
        </div>
      )}

      {/* Bottom handle */}
      {showSourceHandle && !sourceHandles && (
        <Handle type="source" id="bottom" position={Position.Bottom} style={{ left: "50%" }} className={cn(handleBase, handleColors[0])} />
      )}

      {sourceHandles?.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={Position.Bottom}
          className={cn(handleBase, handleColors[0])}
          style={{ left: `${h.position}%` }}
        >
          <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/60 whitespace-nowrap font-medium">
            {h.label}
          </span>
        </Handle>
      ))}
    </div>
  );
}
