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
      {(config.allowedTools?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {config.allowedTools?.slice(0, 3).map((t) => (
            <span key={t} className="text-[9px] bg-secondary/60 rounded px-1 py-0.5">{t}</span>
          ))}
          {(config.allowedTools?.length ?? 0) > 3 && (
            <span className="text-[9px] opacity-50">+{(config.allowedTools?.length ?? 0) - 3}</span>
          )}
        </div>
      )}
    </BaseNode>
  );
}
