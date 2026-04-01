import { eq } from "drizzle-orm";
import { join } from "path";

import { db } from "../db/client";
import { agentTasks, settings } from "../db/schema";
import { agentPool } from "../agent/pool";
import { runOllamaAgent } from "../agent/ollama";
import { runOpenAIAgent, type OpenAIProvider } from "../agent/openai";
import type { AgentResult, ThinkingBlock } from "../agent/runtime";
import { logger } from "../lib/logger";
import { SESSIONS_DIR } from "../lib/workspace";
import { AppError, ErrorCode } from "@openconclave/shared";
import type { AgentConfig } from "@openconclave/shared";

import type { RouteTarget, RunEvent } from "./types";

// ── Ollama tool mapping ─────────────────────────────────────

function mapOllamaTools(config: AgentConfig): string[] {
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

  return tools;
}

// ── Agent Execution ─────────────────────────────────────────

export async function executeAgent(
  runId: number,
  nodeId: string,
  config: AgentConfig,
  input: unknown,
  emit: (event: RunEvent) => void,
  routeTargets?: RouteTarget[],
  sessionId?: string,
  cwd?: string
): Promise<{ output: string; thinking?: ThinkingBlock[]; sessionId?: string }> {
  const now = new Date().toISOString();
  const engine = config.engine ?? "claude";

  if (engine === "ollama" && !config.ollamaModel) {
    throw new AppError(ErrorCode.AGENT_NO_MODEL, "No Ollama model selected");
  }
  if (engine === "openai" && !config.openaiModel) {
    throw new AppError(ErrorCode.AGENT_NO_MODEL, "No OpenAI model selected");
  }

  const modelName = engine === "ollama" ? config.ollamaModel!
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
      "\n\n## Routing",
      "You have multiple possible next steps. You MUST call the openconclave_next tool to choose where to route.",
      "Available routes:",
      routeList,
      "Call openconclave_next with node_id and content. You MUST call it exactly once.",
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

  for (let attempt = 0; attempt <= MAX_ROUTE_RETRIES; attempt++) {
    if (engine === "ollama") {
      const ollamaTools = mapOllamaTools(augmentedConfig);

      // Add openconclave_next tool for routing
      if (routeTargets && routeTargets.length >= 2) {
        ollamaTools.push("openconclave_next");
      }

      // Session file for Ollama — always create path, reuse on subsequent turns
      const tmpDir = SESSIONS_DIR;
      const ollamaSessionFile = sessionId ?? join(tmpDir, `${runId}-${nodeId}.jsonl`);

      result = await runOllamaAgent({
        model: modelName,
        prompt: attempt === 0 ? (augmentedConfig.systemPrompt ?? "") : `Previous attempt failed: you must call openconclave_next to choose a route. Try again.`,
        systemPrompt: augmentedConfig.systemPrompt,
        input,
        tools: ollamaTools.length > 0 ? ollamaTools : undefined,
        routeTargets,
        mcpServers: config.mcpServers,
        cwd,
        sessionFile: ollamaSessionFile,
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
        cwd,
        routeTargets,
        sessionFile: openaiSessionFile,
        maxTurns: config.maxTurns ?? 10,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });

      result.sessionId = openaiSessionFile;
    } else {
      result = await agentPool.submit(String(taskId), {
        config: augmentedConfig,
        input,
        cwd,
        routeTargets,
        sessionId,
        onOutput: (chunk) => {
          emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });
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
