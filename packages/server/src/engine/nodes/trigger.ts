import type { ConclaveDefinition, ConclaveNode, TriggerConfig } from "@openconclave/shared";
import type { RunEvent } from "../types";

export function executeTrigger(
  node: ConclaveNode,
  input: unknown,
  triggerPayload: unknown,
  conclave: ConclaveDefinition,
  runId: number,
  nodeId: string,
  emit: (event: RunEvent) => void
): unknown {
  const config = node.data.config as TriggerConfig;
  if ((config.type === "chat" || config.type === "telegram") && input !== undefined && input !== null) {
    const content = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    emit({
      type: "chat:response",
      runId,
      nodeId,
      data: {
        content,
        conclaveName: conclave.name,
        nodeLabel: node.data.label,
      },
    });
    return { __chatTerminal: true };
  }
  return triggerPayload ?? config.prompt ?? null;
}
