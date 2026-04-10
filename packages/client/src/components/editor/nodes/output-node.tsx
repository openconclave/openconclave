import { type NodeProps } from "@xyflow/react";
import { Send } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import { useConclaveStore } from "@/stores/conclave-store";
import type { OutputConfig } from "@openconclave/shared";

const outputLabels: Record<string, string> = {
  log: "Console Log",
  "claude-code": "Claude Code",
  telegram: "Telegram",
};

const outputOptions = [
  { value: "log", label: "Console Log" },
  { value: "claude-code", label: "Claude Code" },
  { value: "telegram", label: "Telegram" },
];

export function OutputNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as OutputConfig;
  const updateNodeConfig = useConclaveStore((s) => s.updateNodeConfig);

  return (
    <BaseNode
      {...props}
      data={data}
      icon={Send}
      subtitle={outputLabels[config.type] ?? config.type}
      subtitleOptions={outputOptions}
      onSubtitleChange={(value) => updateNodeConfig(props.id, { type: value })}
    />
  );
}
