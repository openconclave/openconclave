import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNodeData } from "@/hooks/use-node-data";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { OutputConfig } from "@openconclave/shared";

const outputLabels: Record<string, string> = {
  log: "Console Log",
  "claude-code": "Claude Code",
  telegram: "Telegram",
};

const handleBase = "!h-3 !w-3 !rounded-full !border-2 !bg-card transition-colors";
const handleColor = "!border-[oklch(0.65_0.18_200)] hover:!bg-[oklch(0.65_0.18_200/0.3)]";

export function OutputNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as OutputConfig;
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
  const isActive = activeNodeIds.has(props.id);

  return (
    <div
      className={cn(
        "w-[220px] rounded-full border bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
        "border-node-output/60",
        "shadow-[0_0_15px_-3px] shadow-node-output/20",
        props.selected && "!border-primary ring-1 ring-primary/30 ring-offset-1 ring-offset-background",
        isActive && "[animation:node-running_1.5s_ease-in-out_infinite] !border-warning"
      )}
      onClick={() => setSelectedNode(props.id)}
    >
      {/* Only top handle — outputs are terminal nodes */}
      <Handle
        type="source"
        id="top"
        position={Position.Top}
        style={{ left: "50%", transform: "translateX(-50%)" }}
        className={cn(handleBase, handleColor)}
      />

      <div className="flex items-center gap-2.5 px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full shrink-0 bg-node-output">
          <Send className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold truncate block">{data.label}</span>
          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {outputLabels[config.type] ?? config.type}
          </span>
        </div>
      </div>
    </div>
  );
}
