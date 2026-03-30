import { type NodeProps } from "@xyflow/react";
import { Code } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { CodeConfig } from "@openconclave/shared";

const runtimeIcons: Record<string, string> = {
  python: "Python",
  node: "Node.js",
  bash: "Bash",
};

export function TransformNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as CodeConfig;

  return (
    <BaseNode {...props} data={data} icon={Code} subtitle={runtimeIcons[config.runtime] ?? config.runtime}>
      {config.code ? (
        <p className="truncate font-mono text-[10px] bg-secondary/40 rounded px-1.5 py-0.5">{config.code.split("\n")[0]}</p>
      ) : (
        <p className="text-[10px] opacity-40 italic">No code</p>
      )}
    </BaseNode>
  );
}
