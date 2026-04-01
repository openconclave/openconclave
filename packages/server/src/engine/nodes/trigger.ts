import type { WorkflowDefinition, WorkflowNode, TriggerConfig } from "@openconclave/shared";
import type { RunEvent } from "../types";

export function executeTrigger(
  node: WorkflowNode,
  input: unknown,
  triggerPayload: unknown,
  workflow: WorkflowDefinition,
  runId: number,
  nodeId: string,
  emit: (event: RunEvent) => void
): unknown {
  const config = node.data.config as TriggerConfig;
  if (config.type === "chat" && input !== undefined && input !== null) {
    const content = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    emit({
      type: "chat:response",
      runId,
      nodeId,
      data: {
        content,
        workflowName: workflow.name,
        nodeLabel: node.data.label,
      },
    });
    return { __chatTerminal: true };
  }
  return triggerPayload ?? config.prompt ?? null;
}
