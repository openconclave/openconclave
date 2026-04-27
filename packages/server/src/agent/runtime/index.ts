import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { VERSION } from "@openconclave/shared";
import { buildSubprocessEnv } from "../subprocess-env";
import { logger } from "../../lib/logger";

import { getCliPath } from "./cli-resolve";
import { isAllowedModel } from "./model";
import { buildPrompt } from "./prompt";
import { buildExternalMcpServers } from "./external-mcp";
import { buildOcFsTools, filterPassthroughTools } from "./oc-mcp-tools";
import { buildConclaveTools } from "./conclave-mcp-tools";
import { consumeStream } from "./sdk-stream";
import type { AgentRunOptions, AgentResult } from "./types";

export type { ThinkingBlock, AgentResult, AgentRunOptions } from "./types";
export { getCliPath } from "./cli-resolve";
export { isAllowedModel } from "./model";

const CONCLAVE_MCP_SERVER_ID = "openconclave-conclave";

function parseKnowledgeBaseIds(ids: string[] | undefined, runId: number | undefined): number[] {
  // Reject non-digit strings (Number("") === 0 would slip id 0 past !isNaN).
  // Log rejected entries so a misconfigured conclave doesn't silently return
  // half-populated results from search_knowledge.
  return (ids ?? [])
    .filter((s) => {
      if (/^\d+$/.test(s)) return true;
      logger.warn("Dropped non-numeric knowledge base id", { id: s, runId });
      return false;
    })
    .map(Number);
}

export async function runClaudeAgent(options: AgentRunOptions): Promise<AgentResult> {
  // Require an explicit workspace so we never silently fall back to process.cwd().
  if (!options.workspace) {
    throw new Error("runClaudeAgent requires options.workspace — none was provided");
  }
  const ws = options.workspace;
  const start = Date.now();

  const promptResult = buildPrompt(options.input, options.onOutput);
  if ("error" in promptResult) {
    return {
      success: false,
      output: "",
      error: promptResult.error,
      durationMs: Date.now() - start,
    };
  }
  const prompt = promptResult.prompt;

  const mcpServers: Record<string, McpServerConfig> = buildExternalMcpServers(
    options.config,
    ws,
    options.runId,
  );

  const ocTools = buildOcFsTools(ws, options.runId, options.config.allowedTools);
  if (ocTools.length > 0) {
    mcpServers.oc = createSdkMcpServer({
      name: "oc",
      version: VERSION,
      tools: ocTools,
    });
  }

  const { tools: conclaveTools, routingState } = buildConclaveTools({
    routeTargets: options.routeTargets,
    promptConfig: options.promptConfig,
    knowledgeBaseIds: parseKnowledgeBaseIds(options.config.knowledgeBases, options.runId),
    abortSignal: options.abortController?.signal,
  });
  if (conclaveTools.length > 0) {
    mcpServers[CONCLAVE_MCP_SERVER_ID] = createSdkMcpServer({
      name: CONCLAVE_MCP_SERVER_ID,
      version: VERSION,
      tools: conclaveTools,
    });
  }

  if (options.config.model && !isAllowedModel(options.config.model)) {
    logger.warn("Unrecognized model; falling back to SDK default", {
      requested: options.config.model,
      runId: options.runId,
    });
  }

  const passthroughTools = filterPassthroughTools(options.config.allowedTools, options.runId);

  const agentQuery = query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: getCliPath(),
      cwd: ws.cwd,
      env: buildSubprocessEnv(options.env ?? {}),
      model: options.config.model && isAllowedModel(options.config.model) ? options.config.model : undefined,
      systemPrompt: options.config.systemPrompt,
      maxTurns: options.config.maxTurns ?? 25,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: passthroughTools,
      mcpServers,
      // Isolate agent from user's personal MCP servers (Gmail, Sknet, etc.) —
      // only servers explicitly passed in mcpServers above are available.
      strictMcpConfig: true,
      resume: options.sessionId,
      // Adaptive thinking is required on Opus 4.7 (enabled+budgetTokens returns 400).
      // display: "summarized" keeps thinking text visible in the response stream so
      // our thinking-block capture still works — the new 4.7 default is "omitted",
      // which would silently blank block.thinking.
      // effort: "high" matches the depth we got from budgetTokens: 31999 on 4.6.
      thinking: options.config.thinking === false
        ? { type: "disabled" as const }
        : { type: "adaptive" as const, display: "summarized" as const },
      effort: "high" as const,
      stderr: (data: string) => options.onOutput?.(`[CLI stderr] ${data}`),
      abortController: options.abortController,
    },
  });

  const outcome = await consumeStream(agentQuery, options.onOutput);
  const durationMs = Date.now() - start;
  const thinking = outcome.thinking.length > 0 ? outcome.thinking : undefined;

  if (outcome.kind === "error") {
    // Drop routeTo — declaring a route before the run failed doesn't mean the
    // route should be followed. Callers that only check routeTo without also
    // checking success would otherwise advance the graph on a broken run.
    return {
      success: false,
      output: routingState.routeContent ?? "",
      error: outcome.error,
      costUsd: outcome.costUsd,
      durationMs,
      thinking,
      sessionId: outcome.sessionId,
    };
  }

  const routeTo = routingState.routeTo;
  const output = routeTo && routingState.routeContent !== undefined ? routingState.routeContent : outcome.output;

  return {
    success: true,
    output,
    costUsd: outcome.costUsd,
    durationMs,
    thinking,
    routeTo,
    sessionId: outcome.sessionId,
  };
}
