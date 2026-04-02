import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Terminal, Server, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData, ToolConfig } from "@openconclave/shared";
import { useWorkflowStore } from "@/stores/workflow-store";

const handleBase = "!h-2.5 !w-2.5 !rounded-full !border-2 !bg-card transition-colors";
const handleColor = "!border-node-tool/60 hover:!bg-node-tool/30";

const toolTypeIcons: Record<ToolConfig["toolType"], React.ElementType> = {
  builtin: Terminal,
  mcp: Server,
  knowledge: BookOpen,
};

const toolTypeAccents: Record<ToolConfig["toolType"], string> = {
  builtin: "bg-node-tool",
  mcp: "bg-node-tool",
  knowledge: "bg-node-knowledge",
};

const toolTypeBorders: Record<ToolConfig["toolType"], string> = {
  builtin: "border-node-tool/60",
  mcp: "border-node-tool/60",
  knowledge: "border-node-knowledge/60",
};

const toolTypeGlows: Record<ToolConfig["toolType"], string> = {
  builtin: "shadow-[0_0_12px_-3px] shadow-node-tool/20",
  mcp: "shadow-[0_0_12px_-3px] shadow-node-tool/20",
  knowledge: "shadow-[0_0_12px_-3px] shadow-node-knowledge/20",
};

export function ToolNode({ id, data, selected }: NodeProps) {
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
  const isActive = activeNodeIds.has(id);

  const nodeData = data as WorkflowNodeData;
  const config = nodeData.config as ToolConfig;
  const toolType = config.toolType ?? "builtin";
  const Icon = toolTypeIcons[toolType];

  return (
    <div
      className={cn(
        "w-[160px] rounded-lg border bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
        toolTypeBorders[toolType],
        toolTypeGlows[toolType],
        selected && "!border-primary ring-1 ring-primary/30 ring-offset-1 ring-offset-background",
        isActive && "[animation:node-running_1.5s_ease-in-out_infinite] !border-warning"
      )}
      onClick={() => setSelectedNode(id)}
    >
      <Handle
        type="source"
        id="top"
        position={Position.Top}
        style={{ left: "50%" }}
        className={cn(handleBase, handleColor)}
      />
      <Handle
        type="source"
        id="left"
        position={Position.Left}
        style={{ top: "50%" }}
        className={cn(handleBase, handleColor)}
      />
      <Handle
        type="source"
        id="right"
        position={Position.Right}
        style={{ top: "50%" }}
        className={cn(handleBase, handleColor)}
      />

      <div className="flex items-center gap-2 px-2.5 py-2">
        <div
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md shrink-0",
            toolTypeAccents[toolType]
          )}
        >
          <Icon className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold truncate block">{nodeData.label}</span>
          <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">{toolType}</span>
        </div>
      </div>

      <Handle
        type="source"
        id="bottom"
        position={Position.Bottom}
        style={{ left: "50%" }}
        className={cn(handleBase, handleColor)}
      />
    </div>
  );
}
