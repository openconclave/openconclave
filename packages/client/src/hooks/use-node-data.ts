import type { NodeProps } from "@xyflow/react";
import type { ConclaveNodeData } from "@openconclave/shared";

/**
 * Extract typed ConclaveNodeData from React Flow NodeProps.
 * React Flow uses generic `Record<string, unknown>` for data,
 * this hook narrows it to our domain type.
 */
export function useNodeData(props: NodeProps): ConclaveNodeData {
  return props.data as ConclaveNodeData;
}
