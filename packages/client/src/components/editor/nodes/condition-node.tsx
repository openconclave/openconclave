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
      subtitle="Branch"
      showSourceHandle={false}
      sourceHandles={[
        { id: "true", label: "True", position: 30 },
        { id: "false", label: "False", position: 70 },
      ]}
    >
      {config.expression ? (
        <p className="truncate font-mono text-[10px] bg-secondary/40 rounded px-1.5 py-0.5">{config.expression}</p>
      ) : (
        <p className="text-[10px] opacity-40 italic">No expression</p>
      )}
    </BaseNode>
  );
}
