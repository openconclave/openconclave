import { type NodeProps } from "@xyflow/react";
import { Combine } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";

export function MergeNode(props: NodeProps) {
  const data = useNodeData(props);

  return (
    <BaseNode {...props} data={data} icon={Combine} subtitle="Fan-in">
      <p className="text-[10px] opacity-60">Waits for all inputs</p>
    </BaseNode>
  );
}
