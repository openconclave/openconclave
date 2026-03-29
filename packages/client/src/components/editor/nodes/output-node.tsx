import { type NodeProps } from "@xyflow/react";
import { Send } from "lucide-react";
import { BaseNode } from "./base-node";
import type { WorkflowNodeData, OutputConfig } from "@openconclave/shared";

export function OutputNode(props: NodeProps) {
  const data = props.data as unknown as WorkflowNodeData;
  const config = data.config as OutputConfig;

  return (
    <BaseNode {...props} data={data} icon={Send} showSourceHandle={false}>
      <span className="capitalize">{config.type}</span>
    </BaseNode>
  );
}
