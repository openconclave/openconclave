import { eq } from "drizzle-orm";
import { join, basename } from "path";

import { db } from "../db/client";
import { agentTasks, settings } from "../db/schema";
import { agentPool } from "../agent/pool";
import { AgentBase } from "../agent/base";
import { TOOL_NAME_MAP } from "../agent/builtin-tools";
import { runOllamaAgent } from "../agent/ollama";
import { runOpenAIAgent, type OpenAIProvider } from "../agent/openai";
import type { AgentResult, ThinkingBlock } from "../agent/runtime";
import { logger } from "../lib/logger";
import { sessionDirForRun } from "../lib/workspace";
import { AppError, ErrorCode } from "@openconclave/shared";
import type { ResolvedAgentConfig, ConclaveNode, ConclaveEdge } from "@openconclave/shared";
import { getOutgoingEdges } from "./graph";
import { ROUTING_TOOL_NAME } from "../agent/constants";

import type { RouteTarget, RunEvent } from "./types";
import type { Workspace } from "./workspace";
import { registerPrompt } from "./prompt-registry";

// ── Ollama tool mapping ─────────────────────────────────────

export function mapOllamaTools(config: ResolvedAgentConfig): string[] {
  const tools: string[] = [];

  if (config.allowedTools) {
    for (const t of config.allowedTools) {
      const mapped = TOOL_NAME_MAP[t];
      if (mapped) tools.push(mapped);
    }
  }

  if (config.enableTelegramTool) {
    tools.push("send_telegram");
  }

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
  edges?: ConclaveEdge[],
  nodeMap?: Map<string, ConclaveNode>,
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
  let firstPromptConfig: { nodeId: string; runId: number; senderNode: string; nodeLabel: string; conclaveName?: string; description?: string } | undefined;

  if (edges && nodeMap) {
    // Check outgoing edges (Agent→Prompt) AND incoming edges (Prompt→Agent)
    // Both directions indicate a bidirectional Channel Loop connection
    const outEdges = getOutgoingEdges(nodeId, edges);
    const promptConnections: { promptNodeId: string; promptNode: ConclaveNode }[] = [];

    for (const e of outEdges) {
      const target = nodeMap.get(e.target);
      if (target?.data.type === "prompt" && !promptConnections.some(p => p.promptNodeId === e.target)) {
        promptConnections.push({ promptNodeId: e.target, promptNode: target });
      }
    }
    // Also check incoming edges from prompt nodes (Prompt→Agent)
    for (const e of edges) {
      if (e.target === nodeId) {
        const source = nodeMap.get(e.source);
        if (source?.data.type === "prompt" && !promptConnections.some(p => p.promptNodeId === e.source)) {
          promptConnections.push({ promptNodeId: e.source, promptNode: source });
        }
      }
    }

    if (promptConnections.length > 0) {
      logger.info(`[ask_user] Agent ${nodeId} has ${promptConnections.length} prompt connection(s): ${promptConnections.map(p => p.promptNodeId).join(", ")}`);
    }
    for (const { promptNodeId, promptNode } of promptConnections) {
          promptToolNodeIds.add(promptNodeId);
          const targetConfig = promptNode.data.config as Record<string, unknown> | undefined;
          const agentLabel = nodeMap.get(nodeId)?.data.label ?? nodeId;
          const promptLabel = promptNode.data.label;
          const promptDescription = (targetConfig?.description as string) ?? undefined;

          // Save first prompt config for Claude agents (MCP-based ask_user)
          if (!firstPromptConfig) {
            firstPromptConfig = { nodeId: promptNodeId, runId, senderNode: agentLabel, nodeLabel: promptLabel, description: promptDescription };
          }

          askUserExtraTools.push({
            tool: {
              type: "function",
              function: {
                name: `ask_user_${promptLabel.replace(/\W+/g, "_")}`,
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
                  conclaveName: "",
                  nodeLabel: promptLabel,
                  senderNode: nodeMap.get(nodeId)?.data.label ?? nodeId,
                  senderType: "agent",
                },
              });
              return registerPrompt(runId, promptNodeId, question, null);
            },
          });
    }

    if (engine === "claude" && promptConnections.length > 1) {
      logger.warn(`Agent ${nodeId} has ${promptConnections.length} prompt connections; Claude path only uses the first. Connect a single prompt node per agent.`, { runId, nodeId });
    }
  }

  // Self-resolve route targets from graph topology if not explicitly provided.
  // Any agent with 2+ outgoing edges gets routing tools automatically.
  // Exclude bidirectional prompt nodes — they are ask_user tools, not forward routes.
  if (!routeTargets && edges && nodeMap) {
    const outEdges = getOutgoingEdges(nodeId, edges)
      .filter((e) => e.targetHandle !== "participants") // exclude discussion participant edges
      .filter((e) => !promptToolNodeIds.has(e.target)); // exclude prompt tool connections
    if (outEdges.length >= 2) {
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

  const augmentedConfig = { ...config };
  if (routeTargets && routeTargets.length >= 2) {
    const routeList = routeTargets
      .map((r) => {
        const desc = r.description ? ` — ${r.description}` : "";
        return `  - "${r.nodeId}" → ${r.label} (${r.type})${desc}`;
      })
      .join("\n");
    const routeInstruction = [
      "\n\n## Routing",
      `When your task is complete, call \`${ROUTING_TOOL_NAME}\` to pass control to the next node.`,
      "",
      "Available routes:",
      routeList,
      "",
      `Call ${ROUTING_TOOL_NAME} with \`node_id\` (the chosen route) and \`content\` (a brief summary of your output).`,
    ].join("\n");
    augmentedConfig.systemPrompt = (config.systemPrompt ?? "") + routeInstruction;
  }

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

  const taskId = taskResult[0]!.id;

  emit({ type: "agent:started", runId, nodeId, data: { taskId, engine } });

  const MAX_ROUTE_RETRIES = 3;
  let result: AgentResult;
  let routedTo: string | null = null;
  let retrySessionId = sessionId; // Track session across retries so the agent can resume
  let taskCompleted = false;
  const executionStart = Date.now();
  const safeNodeId = basename(nodeId).replace(/[^\w.\-]/g, "_");

  try {
  for (let attempt = 0; attempt <= MAX_ROUTE_RETRIES; attempt++) {
    if (engine === "debug") {
      // Resolve tools via AgentBase so debug output shows actual tool definitions
      const agent = new AgentBase(augmentedConfig, workspace, runId);
      await agent.connectMcpServers();
      try {
        const resolvedTools = agent.toChatTools();
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
      } finally {
        await agent.disconnect();
      }
      break;
    } else if (engine === "ollama") {
      const ollamaSessionFile = sessionId ?? join(sessionDirForRun(runId), `${safeNodeId}.jsonl`);

      result = await runOllamaAgent({
        model: modelName,
        prompt: augmentedConfig.systemPrompt ?? "",
        systemPrompt: augmentedConfig.systemPrompt,
        input: attempt === 0 ? input : `You did not call ${ROUTING_TOOL_NAME}. Please call it now to select a route.`,
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
        runId,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });

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

      const openaiSessionFile = sessionId ?? join(sessionDirForRun(runId), `${safeNodeId}.jsonl`);

      result = await runOpenAIAgent({
        provider,
        model: modelName,
        systemPrompt: augmentedConfig.systemPrompt,
        input: attempt === 0 ? input : `You did not call ${ROUTING_TOOL_NAME}. Please call it now to select a route.`,
        allowedTools: config.allowedTools,
        mcpServers: config.mcpServers,
        mcpTools: config.mcpTools,
        knowledgeBases: config.knowledgeBases,
        workspace,
        routeTargets,
        extraTools: askUserExtraTools.length > 0 ? askUserExtraTools : undefined,
        sessionFile: openaiSessionFile,
        maxTurns: config.maxTurns ?? 25,
        runId,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });

      result.sessionId = openaiSessionFile;
    } else {
      const retryInput = attempt === 0
        ? input
        : `You did not call ${ROUTING_TOOL_NAME}. Please call it now to select a route.`;
      result = await agentPool.submit(String(taskId), {
        config: augmentedConfig,
        input: retryInput,
        workspace,
        routeTargets,
        promptConfig: firstPromptConfig,
        sessionId: retrySessionId,
        runId,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });
    }

    if (result.sessionId) {
      retrySessionId = result.sessionId;
    }

    if (!routeTargets || routeTargets.length < 2) break;

    if (result.routeTo) {
      routedTo = result.routeTo;
      break;
    }

    if (attempt < MAX_ROUTE_RETRIES) {
      logger.warn(`Agent didn't route, retry ${attempt + 1}/${MAX_ROUTE_RETRIES}`, { runId, nodeId });
    }
  }

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

  taskCompleted = true;

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
  } catch (err: unknown) {
    if (!taskCompleted) {
      await db
        .update(agentTasks)
        .set({
          status: "failure",
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date().toISOString(),
        })
        .where(eq(agentTasks.id, taskId));
      emit({
        type: "agent:completed",
        runId,
        nodeId,
        data: { taskId, success: false, durationMs: Date.now() - executionStart },
      });
    }
    throw err;
  }
}
