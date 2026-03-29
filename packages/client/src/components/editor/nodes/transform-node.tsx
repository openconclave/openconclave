import { type NodeProps } from "@xyflow/react";
import { Code } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { CodeConfig } from "@openconclave/shared";

export function TransformNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as CodeConfig;

  return (
    <BaseNode {...props} data={data} icon={Code}>
      <p className="text-[10px] opacity-60">{config.runtime ?? "python"}</p>
      {config.code && (
        <p className="truncate font-mono text-[10px]">{config.code.split("\n")[0]}</p>
      )}
    </BaseNode>
  );
}
