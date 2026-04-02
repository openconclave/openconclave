import { type NodeProps } from "@xyflow/react";
import { Cpu } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { AgentConfig } from "@openconclave/shared";

export function AgentNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as AgentConfig;
  const engine = config.engine ?? "claude";
  const model = engine === "ollama" ? config.ollamaModel ?? "ollama"
    : engine === "openai" ? config.openaiModel ?? "openai"
    : config.model ?? "sonnet";

  return (
    <BaseNode {...props} data={data} icon={Cpu} subtitle={`${engine} · ${model}`}>
      {config.systemPrompt && (
        <p className="truncate text-[10px]">{config.systemPrompt}</p>
      )}
    </BaseNode>
  );
}
