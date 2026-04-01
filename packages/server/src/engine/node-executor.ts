import { getIncomingEdges } from "./graph";
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, CodeConfig } from "@openconclave/shared";
import type { RunEvent } from "./types";

import { executeTrigger } from "./nodes/trigger";
import { executeAgentNode } from "./nodes/agent";
import { executeCondition } from "./nodes/condition";
import { executeCode } from "./nodes/code";
import { executeMerge } from "./nodes/merge";
import { executePrompt } from "./nodes/prompt";
import { executeFile } from "./nodes/file";
import { executeOutput } from "./nodes/output";

export async function executeNode(
  runId: number,
  nodeId: string,
  nodeMap: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
  nodeOutputs: Map<string, unknown>,
  agentSessions: Map<string, string>,
  workflowContext: string | null,
  workflow: WorkflowDefinition,
  emit: (event: RunEvent) => void,
  triggerPayload?: unknown,
  triggeredBy?: string | null,
  callerCwd?: string
): Promise<unknown> {
  const node = nodeMap.get(nodeId);
  if (!node) return undefined;

  // Resolve input
  let input: unknown;
  const incomingEdges = getIncomingEdges(nodeId, edges);

  if (triggeredBy) {
    input = nodeOutputs.get(triggeredBy);
  } else if (incomingEdges.length > 1) {
    const inputs: unknown[] = [];
    for (const e of incomingEdges) {
      if (nodeOutputs.has(e.source)) {
        inputs.push(nodeOutputs.get(e.source));
      }
    }
    input = inputs.length === 1 ? inputs[0] : inputs;
  } else if (incomingEdges.length === 1) {
    input = nodeOutputs.get(incomingEdges[0].source);
  }

  emit({ type: "node:started", runId, nodeId });

  try {
    let output: unknown;

    switch (node.data.type) {
      case "trigger":
        output = executeTrigger(node, input, triggerPayload, workflow, runId, nodeId, emit);
        break;
      case "agent":
        output = await executeAgentNode(runId, nodeId, node, nodeMap, edges, nodeOutputs, agentSessions, workflowContext, input, emit, callerCwd);
        break;
      case "condition":
        output = executeCondition(node, input);
        break;
      case "transform":
        output = await executeCode(node.data.config as CodeConfig, input);
        break;
      case "merge":
        output = executeMerge(nodeId, edges, nodeMap, nodeOutputs);
        break;
      case "prompt":
        output = await executePrompt(node, input, workflow, runId, nodeId, triggeredBy, nodeMap, emit);
        break;
      case "file":
        output = executeFile(node);
        break;
      case "output":
        output = await executeOutput(node, input, runId, nodeId, workflow.name, emit);
        break;
    }

    nodeOutputs.set(nodeId, output);
    emit({ type: "node:completed", runId, nodeId, data: output });
    return output;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "node:failed", runId, nodeId, data: { error: message } });
    throw err;
  }
}
