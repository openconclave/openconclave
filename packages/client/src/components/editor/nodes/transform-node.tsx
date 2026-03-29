import { type NodeProps } from "@xyflow/react";
import { Code } from "lucide-react";
import { BaseNode } from "./base-node";
import type { WorkflowNodeData, TransformConfig } from "@openconclave/shared";

export function TransformNode(props: NodeProps) {
  const data = props.data as unknown as WorkflowNodeData;
  const config = data.config as TransformConfig;

  return (
    <BaseNode {...props} data={data} icon={Code}>
      <p className="text-[10px] opacity-60">{config.runtime ?? "python"}</p>
      {config.code && (
        <p className="truncate font-mono text-[10px]">{config.code.split("\n")[0]}</p>
      )}
    </BaseNode>
  );
}
