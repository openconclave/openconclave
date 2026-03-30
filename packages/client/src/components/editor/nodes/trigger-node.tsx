import { type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { TriggerConfig } from "@openconclave/shared";

const triggerLabels: Record<string, string> = {
  manual: "Manual",
  cron: "Scheduled",
  webhook: "Webhook",
  channel: "Channel",
  telegram: "Telegram",
};

export function TriggerNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as TriggerConfig;

  return (
    <BaseNode {...props} data={data} icon={Zap} showTargetHandle={false} subtitle={triggerLabels[config.type] ?? config.type}>
      {config.type === "cron" && config.cron && (
        <div className="font-mono text-[11px] bg-secondary/50 rounded px-1.5 py-0.5 inline-block">{config.cron}</div>
      )}
      {config.prompt && (
        <p className="truncate mt-1 text-[10px] opacity-70">{config.prompt}</p>
      )}
      {config.type === "telegram" && config.chatId && (
        <p className="text-[10px] font-mono opacity-60">ID: {config.chatId}</p>
      )}
    </BaseNode>
  );
}
