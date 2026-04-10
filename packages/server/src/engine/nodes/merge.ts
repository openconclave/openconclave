import type { ConclaveNode, ConclaveEdge } from "@openconclave/shared";
import { getIncomingEdges } from "../graph";

export function executeMerge(
  nodeId: string,
  edges: ConclaveEdge[],
  nodeMap: Map<string, ConclaveNode>,
  nodeOutputs: Map<string, unknown>
): unknown {
  const inEdges = getIncomingEdges(nodeId, edges);
  const merged: Record<string, unknown> = {};
  for (const edge of inEdges) {
    const sourceNode = nodeMap.get(edge.source);
    const key = sourceNode?.data.label ?? edge.source;
    const val = nodeOutputs.get(edge.source);
    if (val !== undefined) merged[key] = val;
  }
  return merged;
}
