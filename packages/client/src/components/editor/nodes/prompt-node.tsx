import { type NodeProps } from "@xyflow/react";
import { MessageCircleQuestion } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";


export function PromptNode(props: NodeProps) {
  const data = useNodeData(props);
  return (
    <BaseNode {...props} data={data} icon={MessageCircleQuestion} subtitle="Pause and ask" />
  );
}
