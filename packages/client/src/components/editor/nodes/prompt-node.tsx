import { type NodeProps } from "@xyflow/react";
import { MessageCircleQuestion } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { PromptConfig } from "@openconclave/shared";

export function PromptNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as PromptConfig;

  return (
    <BaseNode {...props} data={data} icon={MessageCircleQuestion} subtitle="Human-in-the-loop">
      {config.question ? (
        <p className="truncate text-[10px]">{config.question}</p>
      ) : (
        <p className="text-[10px] opacity-40 italic">Question from input</p>
      )}
    </BaseNode>
  );
}
