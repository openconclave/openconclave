import type { ConclaveDefinition, ConclaveNode } from "@openconclave/shared";
import { registerPrompt } from "../prompt-registry";
import { logger } from "../../lib/logger";
import type { RunEvent } from "../types";

export async function executePrompt(
  node: ConclaveNode,
  input: unknown,
  conclave: ConclaveDefinition,
  runId: number,
  nodeId: string,
  triggeredBy: string | null | undefined,
  nodeMap: Map<string, ConclaveNode>,
  emit: (event: RunEvent) => void
): Promise<unknown> {
  const content = typeof input === "string" ? input : input === undefined ? "" : (JSON.stringify(input, null, 2) ?? "");

  const senderNode = triggeredBy ? nodeMap.get(triggeredBy) : null;

  const responsePromise = registerPrompt(runId, nodeId, content, input);
  // A pre-rejected responsePromise (duplicate registration) wins the race and throws here,
  // suppressing the emit below; a pending responsePromise loses to Promise.resolve().
  await Promise.race([responsePromise, Promise.resolve()]);

  emit({
    type: "prompt:question",
    runId,
    nodeId,
    data: {
      question: content,
      waitingForResponse: true,
      conclaveName: conclave.name,
      nodeLabel: node.data.label,
      senderNode: senderNode?.data.label ?? triggeredBy ?? "unknown",
      senderType: senderNode?.data.type ?? "unknown",
    },
  });

  logger.info("Channel-in-the-loop waiting for response", { runId, nodeId });
  return responsePromise;
}
