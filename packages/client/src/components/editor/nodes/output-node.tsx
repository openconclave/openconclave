import { type NodeProps } from "@xyflow/react";
import { Send } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { OutputConfig } from "@openconclave/shared";

export function OutputNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as OutputConfig;

  return (
    <BaseNode {...props} data={data} icon={Send} showSourceHandle={false}>
      <span className="capitalize">{config.type}</span>
    </BaseNode>
  );
}
