import type { WorkflowNode, WorkflowEdge } from "@openconclave/shared";
import { getIncomingEdges } from "../graph";

export function executeMerge(
  nodeId: string,
  edges: WorkflowEdge[],
  nodeMap: Map<string, WorkflowNode>,
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
