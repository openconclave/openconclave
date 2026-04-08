import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { runs } from "../../db/schema";
import { getIncomingEdges } from "../graph";
import { executeAgent } from "../agent-executor";
import { invokeWithTools } from "../../agent/llm-call";
import type { ToolDef } from "../../agent/llm-call";
import { renderTemplate } from "../../lib/template";
import { executeCode } from "./code";
import type {
  WorkflowNode,
  WorkflowEdge,
  AgentConfig,
  CodeConfig,
  ResolvedAgentConfig,
  DiscussionConfig,
  DiscussionModeratorConfig,
} from "@openconclave/shared";
import type { RunEvent } from "../types";
import type { Workspace } from "../workspace";

// ── Constants ────────────────────────────────────────────────

/** Transcript truncation ceiling before passing to moderator. Prevents excessive stdin. */
const TRANSCRIPT_MAX_BYTES = 100_000;

/** Moderator action whitelist. */
const VALID_ACTIONS = new Set(["call_next", "call_specific", "end_discussion"]);

// ── Types ────────────────────────────────────────────────────

interface SpeechRecord {
  agentName: string;
  agentId: string;
  round: number;
  message: string;
}

interface ModeratorResult {
  action: "call_next" | "call_specific" | "end_discussion";
  nextAgent?: string;
  summary?: string;
}

// ── Main executor ────────────────────────────────────────────

export async function executeDiscussion(
  runId: number,
  nodeId: string,
  node: WorkflowNode,
  nodeMap: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
  nodeOutputs: Map<string, unknown>,
  agentSessions: Map<string, string>,
  workflowContext: string | null,
  input: unknown,
  emit: (event: RunEvent) => void,
  workspace?: Workspace,
): Promise<unknown> {
  // Suppress unused param warnings — retained for API consistency with other executors
  void agentSessions;
  void workflowContext;

  const config = node.data.config as DiscussionConfig;

  // Participants come in via edges with targetHandle === "participants"
  const participants = getIncomingEdges(nodeId, edges)
    .filter((e) => e.targetHandle === "participants")
    .map((e) => nodeMap.get(e.source))
    .filter((n): n is WorkflowNode => n?.data.type === "agent");

  const responses: SpeechRecord[] = [];
  let transcript = "";
  let moderatorSummary: string | undefined;
  let round = 0;
  let exitReason = "no_participants";

  emit({
    type: "discussion:started",
    runId,
    nodeId,
    data: {
      participants: participants.map((p) => p.data.label),
      moderatorType: config.moderator?.type ?? null,
      maxRounds: config.maxRounds,
    },
  });

  if (participants.length === 0) {
    emit({
      type: "discussion:completed",
      runId,
      nodeId,
      data: { rounds: 0, exitReason, responseCount: 0 },
    });
    return { responses, transcript, moderatorSummary, rounds: 0, exitReason, input };
  }

  exitReason = "max_rounds";
  let currentParticipantIndex = 0;

  outer: for (round = 1; round <= config.maxRounds; round++) {
    // Cancellation check — graph-walker only checks between queue iterations, not
    // inside long-running executors. At maxRounds=100 with slow agents this matters.
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (run?.status === "cancelled") {
      exitReason = "cancelled";
      break;
    }

    const participant = participants[currentParticipantIndex];
    const agentConfig = participant.data.config as AgentConfig;

    // Resolve tools from agent config — respect what the workflow setup configured
    const connectedTools: string[] = [];
    const connectedMcpServers: string[] = [];
    const connectedKnowledgeBases: string[] = [];
    for (const tool of agentConfig.tools ?? []) {
      if (tool.toolType === "builtin") connectedTools.push(tool.toolId);
      else if (tool.toolType === "mcp") connectedMcpServers.push(tool.toolId);
      else if (tool.toolType === "knowledge") connectedKnowledgeBases.push(tool.toolId);
    }

    const resolvedConfig: ResolvedAgentConfig = {
      ...agentConfig,
      allowedTools: connectedTools,
      mcpServers: connectedMcpServers,
      knowledgeBases: connectedKnowledgeBases,
    };

    // Render the prompt template for this turn
    const promptContext: Record<string, unknown> = {
      agentName: participant.data.label,
      input,
      transcript,
      round,
    };
    const prompt = renderTemplate(config.prompt, promptContext);

    // Invoke participant — ephemeral, no session reuse inside a discussion
    // Pass edges and nodeMap so the agent can self-resolve its graph topology (route targets, etc.)
    const agentResult = await executeAgent(runId, participant.id, resolvedConfig, prompt, emit, undefined, undefined, workspace, edges, nodeMap);

    const message = agentResult.output;
    const speech: SpeechRecord = {
      agentName: participant.data.label,
      agentId: participant.id,
      round,
      message,
    };
    responses.push(speech);
    transcript += `[Round ${round}] ${participant.data.label}: ${message}\n`;

    emit({
      type: "discussion:speech",
      runId,
      nodeId,
      data: { agentName: participant.data.label, agentId: participant.id, round, message },
    });

    // Moderator decision
    if (config.moderator) {
      const modResult = await runModerator(
        config.moderator,
        responses,
        transcript,
        round,
        input,
        runId,
        nodeId,
        emit,
      );

      // Accumulate last non-empty summary and append to transcript so participants can see it
      if (modResult.summary) {
        moderatorSummary = modResult.summary;
        transcript += `[Moderator] ${modResult.summary}\n`;
      }

      emit({
        type: "discussion:moderator",
        runId,
        nodeId,
        data: {
          action: modResult.action,
          nextAgent: modResult.nextAgent,
          summary: modResult.summary,
        },
      });

      if (modResult.action === "end_discussion") {
        exitReason = "end_discussion";
        break outer;
      } else if (modResult.action === "call_specific" && modResult.nextAgent) {
        const idx = participants.findIndex(
          (p) => p.id === modResult.nextAgent || p.data.label === modResult.nextAgent,
        );
        // Fall back to round-robin if nextAgent not found
        currentParticipantIndex = idx >= 0 ? idx : (currentParticipantIndex + 1) % participants.length;
      } else {
        // "call_next" or unrecognized — advance round-robin
        currentParticipantIndex = (currentParticipantIndex + 1) % participants.length;
      }
    } else {
      currentParticipantIndex = (currentParticipantIndex + 1) % participants.length;
    }
  }

  emit({
    type: "discussion:completed",
    runId,
    nodeId,
    data: { rounds: responses.length, exitReason, responseCount: responses.length },
  });

  return { responses, transcript, moderatorSummary, rounds: responses.length, exitReason, input };
}

// ── Moderator dispatch ───────────────────────────────────────

async function runModerator(
  moderator: DiscussionModeratorConfig,
  responses: SpeechRecord[],
  transcript: string,
  round: number,
  input: unknown,
  runId: number,
  nodeId: string,
  emit: (event: RunEvent) => void,
): Promise<ModeratorResult> {
  if (moderator.type === "code") {
    return runCodeModerator(moderator, responses, transcript, round, input);
  }
  return runAgentModerator(moderator, transcript, runId, nodeId, emit);
}

// ── Code moderator ───────────────────────────────────────────

async function runCodeModerator(
  moderator: DiscussionModeratorConfig,
  responses: SpeechRecord[],
  transcript: string,
  round: number,
  input: unknown,
): Promise<ModeratorResult> {
  const config = moderator.node.config as CodeConfig;

  // Truncate transcript to avoid excessive stdin (code.ts passes via new Blob([inputStr]))
  const safeTranscript =
    transcript.length > TRANSCRIPT_MAX_BYTES
      ? transcript.slice(-TRANSCRIPT_MAX_BYTES)
      : transcript;

  const moderatorInput = { responses, transcript: safeTranscript, round, input };

  let rawResult: unknown;
  try {
    // No context: code moderator doesn't need OC_API_URL / OC_WORKFLOW_ID
    rawResult = await executeCode(config, moderatorInput, undefined);
  } catch {
    // Moderator errors must not surface as run failures — default to continuing
    return { action: "call_next" };
  }

  // code.ts returns the raw stdout string when JSON.parse fails — validate before use.
  // Accessing .action on a string → undefined → silent infinite loop until maxRounds.
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
    return { action: "call_next" };
  }

  const r = rawResult as Record<string, unknown>;
  const action = r.action as string;
  if (!VALID_ACTIONS.has(action)) {
    return { action: "call_next" };
  }

  return {
    action: action as ModeratorResult["action"],
    nextAgent: typeof r.nextAgent === "string" ? r.nextAgent : undefined,
    summary: typeof r.summary === "string" ? r.summary : undefined,
  };
}

// ── Agent moderator ──────────────────────────────────────────

async function runAgentModerator(
  moderator: DiscussionModeratorConfig,
  transcript: string,
  runId: number,
  nodeId: string,
  emit: (event: RunEvent) => void,
): Promise<ModeratorResult> {
  const agentConfig = moderator.node.config as AgentConfig;
  const resolvedConfig: ResolvedAgentConfig = {
    ...agentConfig,
    allowedTools: [],
    mcpServers: [],
    knowledgeBases: [],
  };

  const moderateTool: ToolDef = {
    name: "moderate",
    description: "Control the discussion flow. Call this to decide what happens next.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["call_next", "call_specific", "end_discussion"],
          description:
            "call_next = advance round-robin; call_specific = pick a named participant; end_discussion = stop immediately",
        },
        nextAgent: {
          type: "string",
          description: "Required when action=call_specific. Participant label or node ID.",
        },
        summary: {
          type: "string",
          description: "Optional summary of the discussion so far.",
        },
      },
      required: ["action"],
    },
  };

  const safeTranscript =
    transcript.length > TRANSCRIPT_MAX_BYTES
      ? transcript.slice(-TRANSCRIPT_MAX_BYTES)
      : transcript;

  const moderatorResult = await invokeWithTools({
    engine: agentConfig.engine ?? "claude",
    config: resolvedConfig,
    prompt: `Discussion transcript:\n${safeTranscript}\n\nBased on the discussion so far, what should happen next?`,
    tools: [moderateTool],
    runId,
    nodeId,
    emit,
  });

  // llm-call.ts:325 explicitly returns { output: "..." } without tool_call when the agent
  // responds with text instead of calling a tool. Treat as "call_next" — safe default.
  if (!moderatorResult.tool_call) {
    return { action: "call_next" };
  }

  const toolInput = moderatorResult.tool_call.input;
  const action = toolInput.action as string;
  if (!VALID_ACTIONS.has(action)) {
    return { action: "call_next" };
  }

  return {
    action: action as ModeratorResult["action"],
    nextAgent: typeof toolInput.nextAgent === "string" ? toolInput.nextAgent : undefined,
    summary: typeof toolInput.summary === "string" ? toolInput.summary : undefined,
  };
}
