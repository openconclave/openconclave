import { type NodeProps } from "@xyflow/react";
import { Send } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { OutputConfig } from "@openconclave/shared";

const outputLabels: Record<string, string> = {
  log: "Console Log",
  "claude-code": "Claude Code",
  telegram: "Telegram",
};

export function OutputNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as OutputConfig;

  return (
    <BaseNode {...props} data={data} icon={Send} showSourceHandle={false} subtitle={outputLabels[config.type] ?? config.type}>
      {config.type === "telegram" && config.chatId && (
        <p className="text-[10px] font-mono opacity-60">Chat: {config.chatId}</p>
      )}
    </BaseNode>
  );
}
