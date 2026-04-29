import type { ConclaveNode, ConclaveEdge } from "@openconclave/shared";
import { getIncomingEdges } from "../graph";

export function executeMerge(
  nodeId: string,
  edges: ConclaveEdge[],
  _nodeMap: Map<string, ConclaveNode>,
  nodeOutputs: Map<string, unknown>,
  edgeOverrides?: Map<string, unknown>,
): unknown {
  const inEdges = getIncomingEdges(nodeId, edges);
  const merged: Record<string, unknown> = {};
  for (const edge of inEdges) {
    const key = edge.source + ":" + (edge.sourceHandle ?? "");
    if (edgeOverrides?.has(edge.id)) {
      merged[key] = edgeOverrides.get(edge.id) ?? null;
    } else if (nodeOutputs.has(edge.source)) {
      merged[key] = nodeOutputs.get(edge.source) ?? null;
    }
  }
  return merged;
}
