import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNodeData } from "@/hooks/use-node-data";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { TriggerConfig } from "@openconclave/shared";

const triggerLabels: Record<string, string> = {
  manual: "Manual",
  cron: "Scheduled",
  webhook: "Webhook",
  channel: "Channel",
  telegram: "Telegram",
  chat: "Chat",
};

const handleBase = "!h-3 !w-3 !rounded-full !border-2 !bg-card transition-colors";
const handleColor = "!border-[oklch(0.65_0.18_200)] hover:!bg-[oklch(0.65_0.18_200/0.3)]";

export function TriggerNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as TriggerConfig;
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const activeNodeId = useWorkflowStore((s) => s.activeNodeId);
  const isActive = activeNodeId === props.id;

  return (
    <div
      className={cn(
        "w-[220px] rounded-full border bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
        "border-node-trigger/60",
        "shadow-[0_0_15px_-3px] shadow-node-trigger/20",
        props.selected && "!border-primary ring-1 ring-primary/30 ring-offset-1 ring-offset-background",
        isActive && "animate-pulse !border-warning ring-1 ring-warning/30"
      )}
      onClick={() => setSelectedNode(props.id)}
    >
      {/* Chat triggers have a top handle (input) for receiving responses back */}
      {config.type === "chat" && (
        <Handle
          type="source"
          id="top"
          position={Position.Top}
          style={{ left: "50%", transform: "translateX(-50%)" }}
          className={cn(handleBase, handleColor)}
        />
      )}
      {/* Bottom handle — output to workflow */}
      <Handle
        type="source"
        id="bottom"
        position={Position.Bottom}
        style={{ left: "50%", transform: "translateX(-50%)" }}
        className={cn(handleBase, handleColor)}
      />

      <div className="flex items-center gap-2.5 px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full shrink-0 bg-node-trigger">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold truncate block">{data.label}</span>
          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {triggerLabels[config.type] ?? config.type}
          </span>
        </div>
      </div>
    </div>
  );
}
