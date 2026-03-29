import { type NodeProps } from "@xyflow/react";
import { Cpu } from "lucide-react";
import { BaseNode } from "./base-node";
import type { WorkflowNodeData, AgentConfig } from "@openconclave/shared";

export function AgentNode(props: NodeProps) {
  const data = props.data as unknown as WorkflowNodeData;
  const config = data.config as AgentConfig;

  return (
    <BaseNode {...props} data={data} icon={Cpu}>
      <p className="truncate">{config.prompt || "Configure prompt..."}</p>
      <p className="mt-0.5 text-[10px] opacity-60">
        {config.engine === "ollama" ? config.ollamaModel ?? "ollama" : config.model ?? "sonnet"}
      </p>
    </BaseNode>
  );
}
