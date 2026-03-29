import { type NodeProps } from "@xyflow/react";
import { GitFork } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { ConditionConfig } from "@openconclave/shared";

export function ConditionNode(props: NodeProps) {
  const data = useNodeData(props);
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
