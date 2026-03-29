import { type NodeProps } from "@xyflow/react";
import { GitFork } from "lucide-react";
import { BaseNode } from "./base-node";
import type { WorkflowNodeData, ConditionConfig } from "@openconclave/shared";

export function ConditionNode(props: NodeProps) {
  const data = props.data as unknown as WorkflowNodeData;
  const config = data.config as ConditionConfig;

  return (
    <BaseNode
      {...props}
      data={data}
      icon={GitFork}
      showSourceHandle={false}
      sourceHandles={[
        { id: "true", label: "True", position: 30 },
        { id: "false", label: "False", position: 70 },
      ]}
    >
      <p className="truncate font-mono">{config.expression || "expression..."}</p>
    </BaseNode>
  );
}
