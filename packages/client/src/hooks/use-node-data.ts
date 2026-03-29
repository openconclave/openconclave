import type { NodeProps } from "@xyflow/react";
import type { WorkflowNodeData } from "@openconclave/shared";

/**
 * Extract typed WorkflowNodeData from React Flow NodeProps.
 * React Flow uses generic `Record<string, unknown>` for data,
 * this hook narrows it to our domain type.
 */
export function useNodeData(props: NodeProps): WorkflowNodeData {
  return props.data as WorkflowNodeData;
}
