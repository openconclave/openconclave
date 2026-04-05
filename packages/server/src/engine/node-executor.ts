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
import { executeDiscussion } from "./nodes/discussion";

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

  // Discussion nodes: participant edges are not data-flow. Exclude them so input resolution
  // doesn't accidentally fold participant agent outputs (or undefined) into the discussion input.
  const dataIncomingEdges =
    node.data.type === "discussion"
      ? incomingEdges.filter((e) => e.targetHandle !== "participants")
      : incomingEdges;

  if (triggeredBy) {
    input = nodeOutputs.get(triggeredBy);
    // Apply discussion output filtering based on sourceHandle
    const triggerNode = nodeMap.get(triggeredBy);
    if (triggerNode?.data.type === "discussion" && input) {
      const triggerEdge = dataIncomingEdges.find((e) => e.source === triggeredBy);
      if (triggerEdge?.sourceHandle) {
        input = filterDiscussionOutput(input, triggerEdge.sourceHandle);
      }
    }
  } else if (dataIncomingEdges.length > 1) {
    const inputs: unknown[] = [];
    for (const e of dataIncomingEdges) {
      if (nodeOutputs.has(e.source)) {
        let val = nodeOutputs.get(e.source);
        // Apply discussion output filtering based on sourceHandle
        const srcNode = nodeMap.get(e.source);
        if (srcNode?.data.type === "discussion" && val && e.sourceHandle) {
          val = filterDiscussionOutput(val, e.sourceHandle);
        }
        inputs.push(val);
      }
    }
    input = inputs.length === 1 ? inputs[0] : inputs;
  } else if (dataIncomingEdges.length === 1) {
    input = nodeOutputs.get(dataIncomingEdges[0].source);
    // Apply discussion output filtering based on sourceHandle
    const edge = dataIncomingEdges[0];
    const srcNode = nodeMap.get(edge.source);
    if (srcNode?.data.type === "discussion" && input && edge.sourceHandle) {
      input = filterDiscussionOutput(input, edge.sourceHandle);
    }
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
      case "code":
        output = await executeCode(node.data.config as CodeConfig, input, {
          workflowId: workflow.id!,
          runId,
          nodeId,
        });
        break;
      case "merge":
        output = executeMerge(nodeId, edges, nodeMap, nodeOutputs);
        break;
      case "prompt":
        output = await executePrompt(node, input, workflow, runId, nodeId, triggeredBy, nodeMap, emit);
        break;
      case "file":
        output = executeFile(node, input, callerCwd);
        break;
      case "output":
        output = await executeOutput(node, input, runId, nodeId, workflow.name, emit);
        break;
      case "discussion":
        output = await executeDiscussion(
          runId,
          nodeId,
          node,
          nodeMap,
          edges,
          nodeOutputs,
          agentSessions,
          workflowContext,
          input,
          emit,
          callerCwd,
        );
        break;
      default: {
        const _exhaustive: never = node.data.type;
        throw new Error(`Unknown node type: ${_exhaustive}`);
      }
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

// ── Discussion output filtering ──────────────────────────────

interface SpeechRecord {
  agentName: string;
  agentId: string;
  round: number;
  message: string;
}

interface DiscussionOutput {
  responses: SpeechRecord[];
  transcript: string;
  moderatorSummary: string | null;
  rounds: number;
  exitReason: string;
  input: unknown;
}

function isDiscussionOutput(val: unknown): val is DiscussionOutput {
  return (
    typeof val === "object" &&
    val !== null &&
    "responses" in val &&
    Array.isArray((val as DiscussionOutput).responses) &&
    "transcript" in val
  );
}

function filterDiscussionOutput(output: unknown, sourceHandle: string): unknown {
  if (!isDiscussionOutput(output)) return output;

  switch (sourceHandle) {
    case "full":
      return output;

    case "last": {
      // Keep only the last message from each unique agent
      const lastPerAgent = new Map<string, SpeechRecord>();
      for (const r of output.responses) {
        lastPerAgent.set(r.agentId, r);
      }
      return {
        responses: Array.from(lastPerAgent.values()),
        moderatorSummary: output.moderatorSummary,
        rounds: output.rounds,
        exitReason: output.exitReason,
        input: output.input,
      };
    }

    case "summary":
      return {
        summary: output.moderatorSummary,
        input: output.input,
      };

    default:
      // Unknown handle (e.g. legacy "bottom") — return full output
      return output;
  }
}
