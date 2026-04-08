import { type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { BaseNode } from "./base-node";
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

const triggerOptions = [
  { value: "manual", label: "Manual" },
  { value: "chat", label: "Chat" },
  { value: "cron", label: "Scheduled" },
  { value: "webhook", label: "Webhook" },
  { value: "telegram", label: "Telegram" },
];

export function TriggerNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as TriggerConfig;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  return (
    <BaseNode
      {...props}
      data={data}
      icon={Zap}
      subtitle={triggerLabels[config.type] ?? config.type}
      subtitleOptions={triggerOptions}
      onSubtitleChange={(value) => updateNodeConfig(props.id, { type: value })}
    />
  );
}
