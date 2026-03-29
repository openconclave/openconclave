import { type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import type { TriggerConfig } from "@openconclave/shared";

export function TriggerNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as TriggerConfig;

  return (
    <BaseNode {...props} data={data} icon={Zap} showTargetHandle={false}>
      <span className="capitalize">{config.type}</span>
      {config.type === "cron" && config.cron && <span className="ml-1 font-mono">{config.cron}</span>}
      {config.prompt && (
        <p className="mt-0.5 text-[10px] opacity-60 truncate">{config.prompt}</p>
      )}
    </BaseNode>
  );
}
