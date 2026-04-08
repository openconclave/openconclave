import { eq } from "drizzle-orm";
import { join } from "path";

import { db } from "../db/client";
import { agentTasks, settings } from "../db/schema";
import { agentPool } from "../agent/pool";
import { AgentBase } from "../agent/base";
import { runOllamaAgent } from "../agent/ollama";
import { runOpenAIAgent, type OpenAIProvider } from "../agent/openai";
import type { AgentResult, ThinkingBlock } from "../agent/runtime";
import { logger } from "../lib/logger";
import { SESSIONS_DIR } from "../lib/workspace";
import { AppError, ErrorCode } from "@openconclave/shared";
import type { ResolvedAgentConfig, WorkflowNode, WorkflowEdge } from "@openconclave/shared";
import { getOutgoingEdges } from "./graph";

import type { RouteTarget, RunEvent } from "./types";
import type { Workspace } from "./workspace";
import { registerPrompt } from "./prompt-registry";

// ── Ollama tool mapping ─────────────────────────────────────

export function mapOllamaTools(config: ResolvedAgentConfig): string[] {
  const tools: string[] = [];
  const toolMap: Record<string, string> = {
    Bash: "bash",
    Read: "read_file",
    Write: "write_file",
    WebFetch: "web_fetch",
  };

  if (config.allowedTools) {
    for (const t of config.allowedTools) {
      const mapped = toolMap[t];
      if (mapped) tools.push(mapped);
    }
  }

  if (config.mcpServers?.includes("telegram-voice")) {
    tools.push("send_telegram");
  }

  // Add knowledge tools when agent has knowledge bases attached
  if (config.knowledgeBases && config.knowledgeBases.length > 0) {
    tools.push("search_knowledge", "knowledge_fetch", "knowledge_add");
  }

  return tools;
}

// ── Agent Execution ─────────────────────────────────────────

export async function executeAgent(
  runId: number,
  nodeId: string,
  config: ResolvedAgentConfig,
  input: unknown,
  emit: (event: RunEvent) => void,
  routeTargets?: RouteTarget[],
  sessionId?: string,
  workspace?: Workspace,
  edges?: WorkflowEdge[],
  nodeMap?: Map<string, WorkflowNode>,
): Promise<{ output: string; thinking?: ThinkingBlock[]; sessionId?: string }> {
  const now = new Date().toISOString();
  const engine = config.engine ?? "claude";

  // Detect bidirectional prompt connections (agent ↔ prompt) and convert to ask_user tools.
  // These are tool connections, not forward routes — exclude from route targets.
  const askUserExtraTools: Array<{
    tool: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
    execute: (args: Record<string, unknown>) => Promise<string>;
  }> = [];
  const promptToolNodeIds = new Set<string>();

  if (edges && nodeMap) {
    const outEdges = getOutgoingEdges(nodeId, edges);
    for (const e of outEdges) {
      const target = nodeMap.get(e.target);
      if (target?.data.type === "prompt") {
          promptToolNodeIds.add(e.target);
          const targetConfig = target.data.config as Record<string, unknown> | undefined;
          const agentLabel = nodeMap.get(nodeId)?.data.label ?? nodeId;
          const promptNodeId = e.target;
          const promptLabel = target.data.label;
          const promptDescription = (targetConfig?.description as string) ?? undefined;

          askUserExtraTools.push({
            tool: {
              type: "function",
              function: {
                name: "ask_user",
                description: promptDescription || "Ask the user a question and wait for their response. Use when you need clarification or more information.",
                parameters: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "The question to ask the user" },
                  },
                  required: ["question"],
                },
              },
            },
            execute: async (args: Record<string, unknown>): Promise<string> => {
              const question = String(args.question ?? "");
              emit({
                type: "prompt:question",
                runId,
                nodeId: promptNodeId,
                data: {
                  question,
                  waitingForResponse: true,
                  workflowName: "",
                  nodeLabel: promptLabel,
                  senderNode: agentLabel,
                  senderType: "agent",
                },
              });
              return registerPrompt(runId, promptNodeId, question, null);
            },
          });
      }
    }
  }

  // Self-resolve route targets from graph topology if not explicitly provided.
  // Any agent with 2+ outgoing edges gets routing tools automatically.
  // Exclude bidirectional prompt nodes — they are ask_user tools, not forward routes.
  if (!routeTargets && edges && nodeMap) {
    const outEdges = getOutgoingEdges(nodeId, edges)
      .filter((e) => e.targetHandle !== "participants") // exclude discussion participant edges
      .filter((e) => !promptToolNodeIds.has(e.target)); // exclude prompt tool connections
    if (outEdges.length >= 1) {
      routeTargets = outEdges.map((e) => {
        const target = nodeMap.get(e.target);
        const targetConfig = target?.data.config as Record<string, unknown> | undefined;
        const description = targetConfig?.description as string | undefined;
        return {
          nodeId: e.target,
          label: target?.data.label ?? e.target,
          type: target?.data.type ?? "unknown",
          description,
        };
      });
    }
  }

  if (engine === "ollama" && !config.ollamaModel) {
    throw new AppError(ErrorCode.AGENT_NO_MODEL, "No Ollama model selected");
  }
  if (engine === "openai" && !config.openaiModel) {
    throw new AppError(ErrorCode.AGENT_NO_MODEL, "No OpenAI model selected");
  }

  const modelName = engine === "debug" ? "debug"
    : engine === "ollama" ? config.ollamaModel!
    : engine === "openai" ? config.openaiModel!
    : (config.model ?? "sonnet");

  // Build routing-aware config
  const augmentedConfig = { ...config };
  if (routeTargets && routeTargets.length >= 2) {
    const routeList = routeTargets
      .map((r) => {
        const desc = r.description ? ` — ${r.description}` : "";
        return `  - "${r.nodeId}" → ${r.label} (${r.type})${desc}`;
      })
      .join("\n");
    const routeInstruction = [
      "\n\n## ⚠️ CRITICAL: Routing (REQUIRED)",
      "When you have finished your work, you MUST call the `openconclave_next` tool to exit.",
      "Do NOT keep working after your task is complete. Do NOT re-read or re-analyze files you already changed.",
      "If you have completed the task, STOP and call `openconclave_next` immediately.",
      "",
      "Available routes:",
      routeList,
      "",
      "Call openconclave_next with `node_id` (the route) and `content` (your summary). You MUST call it exactly once.",
      "Failure to call this tool means the workflow hangs forever.",
    ].join("\n");
    augmentedConfig.systemPrompt = (config.systemPrompt ?? "") + routeInstruction;
  }

  // Store user message as prompt, augmented system prompt in DB
  const userMessage = typeof input === "string" ? input : (input ? JSON.stringify(input) : null);
  const taskResult = await db.insert(agentTasks).values({
    runId,
    nodeId,
    status: "running",
    prompt: userMessage ?? "(no input)",
    systemPrompt: augmentedConfig.systemPrompt,
    model: `${engine}/${modelName}`,
    input: input ?? null,
    startedAt: now,
    createdAt: now,
  }).returning({ id: agentTasks.id });

  const taskId = taskResult[0].id;

  emit({ type: "agent:started", runId, nodeId, data: { taskId, engine } });

  const MAX_ROUTE_RETRIES = 3;
  let result: AgentResult;
  let routedTo: string | null = null;
  let retrySessionId = sessionId; // Track session across retries so the agent can resume

  for (let attempt = 0; attempt <= MAX_ROUTE_RETRIES; attempt++) {
    if (engine === "debug") {
      // Resolve tools via AgentBase so debug output shows actual tool definitions
      const agent = new AgentBase(augmentedConfig, workspace);
      await agent.connectMcpServers();
      const resolvedTools = agent.toChatTools();
      await agent.disconnect();

      // Include ask_user tools in debug output so users can verify the tool was injected
      const allTools = [
        ...resolvedTools,
        ...askUserExtraTools.map((et) => et.tool),
      ];

      const debugInfo = {
        debugResponse: config.debugResponse ?? "(no debug response configured)",
        receivedInput: input,
        systemPrompt: augmentedConfig.systemPrompt,
        tools: allTools,
        knowledgeBases: config.knowledgeBases,
        routeTargets: routeTargets ?? [],
        workspace: workspace ? {
          cwd: workspace.cwd,
          allowedDirs: workspace.getAllowedDirs(),
        } : null,
      };
      result = {
        success: true,
        output: JSON.stringify(debugInfo, null, 2),
        durationMs: 0,
      };
      break;
    } else if (engine === "ollama") {
      // Session file for Ollama — always create path, reuse on subsequent turns
      const tmpDir = SESSIONS_DIR;
      const ollamaSessionFile = sessionId ?? join(tmpDir, `${runId}-${nodeId}.jsonl`);

      result = await runOllamaAgent({
        model: modelName,
        prompt: attempt === 0 ? (augmentedConfig.systemPrompt ?? "") : `Previous attempt failed: you must call openconclave_next to choose a route. Try again.`,
        systemPrompt: augmentedConfig.systemPrompt,
        input,
        allowedTools: config.allowedTools,
        knowledgeBases: config.knowledgeBases,
        routeTargets,
        extraTools: askUserExtraTools.length > 0 ? askUserExtraTools : undefined,
        mcpServers: config.mcpServers,
        mcpTools: config.mcpTools,
        workspace,
        sessionFile: ollamaSessionFile,
        maxTurns: config.maxTurns ?? 25,
        thinking: config.thinking ?? true,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });

      // Store session file path for next turn
      result.sessionId = ollamaSessionFile;
    } else if (engine === "openai") {
      // OpenAI-compatible provider — load provider config from settings
      const providerId = config.providerId;
      if (!providerId) {
        throw new AppError(ErrorCode.AGENT_NO_MODEL, "No OpenAI provider selected");
      }
      const providerRow = await db.select().from(settings).where(eq(settings.key, `provider:${providerId}`)).get();
      if (!providerRow) {
        throw new AppError(ErrorCode.AGENT_NO_MODEL, `Provider "${providerId}" not found in settings`);
      }
      const provider = JSON.parse(providerRow.value) as OpenAIProvider;

      const openaiSessionFile = sessionId ?? join(SESSIONS_DIR, `${runId}-${nodeId}.jsonl`);

      result = await runOpenAIAgent({
        provider,
        model: modelName,
        systemPrompt: augmentedConfig.systemPrompt,
        input,
        allowedTools: config.allowedTools,
        mcpServers: config.mcpServers,
        mcpTools: config.mcpTools,
        knowledgeBases: config.knowledgeBases,
        workspace,
        routeTargets,
        extraTools: askUserExtraTools.length > 0 ? askUserExtraTools : undefined,
        sessionFile: openaiSessionFile,
        maxTurns: config.maxTurns ?? 25,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });

      result.sessionId = openaiSessionFile;
    } else {
      const retryInput = attempt === 0
        ? input
        : "You completed your task but forgot to call openconclave_next. Call it NOW to route to the next step.";
      result = await agentPool.submit(String(taskId), {
        config: augmentedConfig,
        input: retryInput,
        workspace,
        routeTargets,
        sessionId: retrySessionId,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });
    }

    // Capture session for retry resume (all engines)
    if (result.sessionId) {
      retrySessionId = result.sessionId;
    }

    // If no routing needed, break immediately
    if (!routeTargets || routeTargets.length < 2) break;

    // Check if agent called openconclave_next (route written to state file)
    if (result.routeTo) {
      routedTo = result.routeTo;
      break;
    }

    // No route — retry if routing was required
    if (attempt < MAX_ROUTE_RETRIES) {
      logger.warn(`Agent didn't route, retry ${attempt + 1}/${MAX_ROUTE_RETRIES}`, { runId, nodeId });
    }
  }

  // Store route in output metadata
  if (routedTo) {
    result!.output = JSON.stringify({ __routeTo: routedTo, content: result!.output });
  }

  const completedAt = new Date().toISOString();
  await db
    .update(agentTasks)
    .set({
      status: result!.success ? "success" : "failure",
      output: result!.output,
      error: result!.error,
      costUsd: result!.costUsd,
      completedAt,
    })
    .where(eq(agentTasks.id, taskId));

  // Emit thinking blocks as separate events for observability
  if (result!.thinking && result!.thinking.length > 0) {
    emit({
      type: "agent:thinking",
      runId,
      nodeId,
      data: { taskId, thinking: result!.thinking },
    });
  }

  emit({
    type: "agent:completed",
    runId,
    nodeId,
    data: { taskId, success: result!.success, durationMs: result!.durationMs },
  });

  if (!result!.success) {
    throw new AppError(ErrorCode.AGENT_FAILED, `Agent task failed: ${result!.error}`);
  }

  return {
    output: result!.output,
    thinking: result!.thinking,
    sessionId: result!.sessionId,
  };
}
