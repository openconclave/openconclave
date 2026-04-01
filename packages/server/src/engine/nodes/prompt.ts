import type { WorkflowDefinition, WorkflowNode } from "@openconclave/shared";
import { registerPrompt } from "../prompt-registry";
import { logger } from "../../lib/logger";
import type { RunEvent } from "../types";

export async function executePrompt(
  node: WorkflowNode,
  input: unknown,
  workflow: WorkflowDefinition,
  runId: number,
  nodeId: string,
  triggeredBy: string | null | undefined,
  nodeMap: Map<string, WorkflowNode>,
  emit: (event: RunEvent) => void
): Promise<unknown> {
  const content = typeof input === "string" ? input : JSON.stringify(input, null, 2);

  const senderNode = triggeredBy ? nodeMap.get(triggeredBy) : null;

  emit({
    type: "prompt:question",
    runId,
    nodeId,
    data: {
      question: content,
      waitingForResponse: true,
      workflowName: workflow.name,
      nodeLabel: node.data.label,
      senderNode: senderNode?.data.label ?? triggeredBy ?? "unknown",
      senderType: senderNode?.data.type ?? "unknown",
    },
  });

  logger.info("Channel-in-the-loop waiting for response", { runId, nodeId });
  return registerPrompt(runId, nodeId, content, input);
}
