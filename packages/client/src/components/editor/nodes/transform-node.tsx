import { type NodeProps } from "@xyflow/react";
import { Shuffle } from "lucide-react";
import { BaseNode } from "./base-node";
import type { WorkflowNodeData, TransformConfig } from "@openconclave/shared";

export function TransformNode(props: NodeProps) {
  const data = props.data as unknown as WorkflowNodeData;
  const config = data.config as TransformConfig;

  return (
    <BaseNode {...props} data={data} icon={Shuffle}>
      <p className="truncate font-mono">{config.expression || "expression..."}</p>
    </BaseNode>
  );
}
