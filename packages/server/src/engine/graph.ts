import type { ConclaveNode, ConclaveEdge } from "@openconclave/shared";
import { AppError, ErrorCode } from "@openconclave/shared";

export type ExecutionLayer = {
  nodeIds: string[];
};

export function topologicalSort(
  nodes: ConclaveNode[],
  edges: ConclaveEdge[]
): ExecutionLayer[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      const invalid = !nodeMap.has(edge.source) ? edge.source : edge.target;
      throw AppError.validation(
        `Edge references invalid node "${invalid}" not found in conclave`,
        { edgeId: edge.id, source: edge.source, target: edge.target }
      );
    }
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, inDegree.get(edge.target)! + 1);
  }

  const layers: ExecutionLayer[] = [];
  const visited = new Set<string>();

  while (visited.size < nodes.length) {
    const layer: string[] = [];

    for (const [id, degree] of inDegree) {
      if (!visited.has(id) && degree === 0) {
        layer.push(id);
      }
    }

    if (layer.length === 0) {
      const cycleNodes = [...inDegree.keys()].filter((id) => !visited.has(id));
      throw new AppError(
        ErrorCode.CONCLAVE_CYCLE_DETECTED,
        `Cycle detected involving nodes: ${cycleNodes.join(", ")}`,
        422
      );
    }

    for (const id of layer) {
      visited.add(id);
      for (const target of adjacency.get(id) ?? []) {
        inDegree.set(target, (inDegree.get(target) ?? 0) - 1);
      }
    }

    layers.push({ nodeIds: layer });
  }

  return layers;
}

export function getIncomingEdges(nodeId: string, edges: ConclaveEdge[]): ConclaveEdge[] {
  return edges.filter((e) => e.target === nodeId);
}

export function getOutgoingEdges(nodeId: string, edges: ConclaveEdge[]): ConclaveEdge[] {
  return edges.filter((e) => e.source === nodeId);
}
