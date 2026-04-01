import { type NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";

export function FileNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as { path?: string };
  const fileName = config.path ? config.path.split(/[/\\]/).pop() : "No file";

  return (
    <BaseNode {...props} data={data} icon={FileText} subtitle={fileName}>
      {config.path && (
        <p className="truncate text-[10px] opacity-60 font-mono">{config.path}</p>
      )}
    </BaseNode>
  );
}
