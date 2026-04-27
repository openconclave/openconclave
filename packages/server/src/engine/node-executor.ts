import { getIncomingEdges } from "./graph";
import type { ConclaveDefinition, ConclaveNode, ConclaveEdge, CodeConfig } from "@openconclave/shared";
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
import { Workspace } from "./workspace";

export async function executeNode(
  runId: number,
  nodeId: string,
  nodeMap: Map<string, ConclaveNode>,
  edges: ConclaveEdge[],
  nodeOutputs: Map<string, unknown>,
  agentSessions: Map<string, string>,
  conclaveContext: string | null,
  conclave: ConclaveDefinition,
  emit: (event: RunEvent) => void,
  triggerPayload?: unknown,
  triggeredBy?: string | null,
  triggeredByEdgeId?: string,
  workspace?: Workspace
): Promise<unknown> {
  const node = nodeMap.get(nodeId);
  if (!node) return undefined;

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
    const triggerNode = nodeMap.get(triggeredBy);
    if (triggerNode?.data.type === "discussion" && input) {
      const triggerEdge = triggeredByEdgeId
        ? dataIncomingEdges.find((e) => e.id === triggeredByEdgeId)
        : dataIncomingEdges.find((e) => e.source === triggeredBy);
      const h = triggerEdge?.sourceHandle;
      if (h === "full" || h === "last" || h === "summary") {
        input = filterDiscussionOutput(input as DiscussionOutput, h);
      }
    }
  } else if (dataIncomingEdges.length > 1) {
    const inputs: unknown[] = [];
    for (const e of dataIncomingEdges) {
      if (nodeOutputs.has(e.source)) {
        let val = nodeOutputs.get(e.source);
        const srcNode = nodeMap.get(e.source);
        if (srcNode?.data.type === "discussion" && val) {
          const h = e.sourceHandle;
          if (h === "full" || h === "last" || h === "summary") {
            val = filterDiscussionOutput(val as DiscussionOutput, h);
          }
        }
        inputs.push(val);
      }
    }
    input = inputs.length === 1 ? inputs[0] : inputs;
  } else if (dataIncomingEdges.length === 1) {
    const edge = dataIncomingEdges[0]!;
    input = nodeOutputs.get(edge.source);
    const srcNode = nodeMap.get(edge.source);
    if (srcNode?.data.type === "discussion" && input) {
      const h = edge.sourceHandle;
      if (h === "full" || h === "last" || h === "summary") {
        input = filterDiscussionOutput(input as DiscussionOutput, h);
      }
    }
  }

  emit({ type: "node:started", runId, nodeId });

  try {
    let output: unknown;

    switch (node.data.type) {
      case "trigger":
        output = executeTrigger(node, input, triggerPayload, conclave, runId, nodeId, emit);
        break;
      case "agent":
        output = await executeAgentNode(runId, nodeId, node, nodeMap, edges, nodeOutputs, agentSessions, conclaveContext, input, emit, workspace);
        break;
      case "condition":
        output = executeCondition(node, input);
        break;
      case "code":
        output = await executeCode(
          node.data.config as CodeConfig,
          input,
          { conclaveId: Number(conclave.id), runId, nodeId },
          workspace ?? new Workspace(),
        );
        break;
      case "merge": {
        const filteredOutputs = new Map(nodeOutputs);
        for (const e of getIncomingEdges(nodeId, edges)) {
          const srcNode = nodeMap.get(e.source);
          if (srcNode?.data.type === "discussion") {
            const h = e.sourceHandle;
            if (h === "full" || h === "last" || h === "summary") {
              const raw = nodeOutputs.get(e.source);
              if (raw !== undefined) {
                filteredOutputs.set(e.source, filterDiscussionOutput(raw as DiscussionOutput, h));
              }
            }
          }
        }
        output = executeMerge(nodeId, edges, nodeMap, filteredOutputs);
        break;
      }
      case "prompt":
        output = await executePrompt(node, input, conclave, runId, nodeId, triggeredBy, nodeMap, emit);
        break;
      case "file":
        output = executeFile(node, input, workspace);
        break;
      case "output":
        output = await executeOutput(node, input, runId, nodeId, conclave.name, emit);
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
          conclaveContext,
          input,
          emit,
          workspace,
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

function filterDiscussionOutput(output: DiscussionOutput, sourceHandle: "full" | "last" | "summary"): unknown {
  switch (sourceHandle) {
    case "full":
      return output;

    case "last": {
      const lastPerAgent = new Map<string, SpeechRecord>();
      for (const r of output.responses) {
        lastPerAgent.set(r.agentId, r);
      }
      const lastResponses = Array.from(lastPerAgent.values());
      return {
        responses: lastResponses,
        transcript: lastResponses.map(r => `[Round ${r.round}] ${r.agentName}: ${r.message}`).join('\n'),
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

    default: {
      const _exhaustive: never = sourceHandle;
      throw new Error(`Unknown discussion sourceHandle: ${_exhaustive}`);
    }
  }
}
