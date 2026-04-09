import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync, unlinkSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import { TMP_DIR } from "../lib/workspace";
import { Workspace } from "../engine/workspace";

export interface ThinkingBlock {
  thinking: string;
  signature?: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  costUsd?: number;
  durationMs: number;
  thinking?: ThinkingBlock[];
  routeTo?: string;
  sessionId?: string;
}

export interface RouteTarget {
  nodeId: string;
  label: string;
  type: string;
}

export type AgentRunOptions = {
  config: ResolvedAgentConfig;
  routeTargets?: RouteTarget[];
  promptConfig?: { nodeId: string; runId: number; senderNode: string; description?: string };
  sessionId?: string;
  input?: unknown;
  workspace?: Workspace;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
  onOutput?: (chunk: string) => void;
};

const modelMap: Record<string, string> = {
  sonnet: "sonnet",
  opus: "opus",
  haiku: "haiku",
};

export async function runClaudeAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { config, input, env, abortSignal, onOutput } = options;
  const ws = options.workspace ?? new Workspace();
  const startTime = Date.now();

  // Build the prompt
  let prompt: string;
  if (input !== undefined && input !== null && input !== "") {
    prompt = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } else {
    prompt = "Start";
  }

  // Build MCP server config from workspace (single source of truth for dirs + configs)
  // Claude SDK only supports stdio transport — remote servers are handled by McpBridge in other engines.
  const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  if (config.mcpServers?.length) {
    const mcpTools = config.mcpTools ?? [];
    const legacyIds = config.mcpServers.filter(
      (id) => !mcpTools.some((t) => t.toolId === id),
    );
    const resolved = ws.getMcpToolConfigs(mcpTools, legacyIds);
    for (const [id, cfg] of Object.entries(resolved)) {
      // Claude SDK only supports stdio MCP servers
      if (cfg.transport === "stdio" && cfg.command) {
        mcpServers[id] = { command: cfg.command, args: cfg.args ?? [], env: cfg.env };
      }
    }
  }

  // Add OpenConclave workflow MCP server for routing and knowledge tools
  const routeTargets = options.routeTargets;
  const knowledgeBaseIds = config.knowledgeBases?.map(Number).filter((n) => !isNaN(n)) ?? [];
  let stateFile: string | null = null;
  const promptConfig = options.promptConfig;
  const needsWorkflowMcp = (routeTargets && routeTargets.length >= 1) || knowledgeBaseIds.length > 0 || !!promptConfig;

  if (needsWorkflowMcp) {
    const tmpDir = TMP_DIR;
    mkdirSync(tmpDir, { recursive: true });
    stateFile = join(tmpDir, `state-${Date.now()}.json`);

    const workflowMcpPath = resolve(import.meta.dir, "workflow-mcp-server.ts");
    const apiUrl = process.env.OC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    const mcpEnv: Record<string, string> = {
      OC_STATE_FILE: stateFile,
      OC_ROUTE_TARGETS: JSON.stringify(routeTargets ?? []),
      OC_API_URL: apiUrl,
    };
    if (knowledgeBaseIds.length > 0) {
      mcpEnv.OC_KNOWLEDGE_BASE_IDS = JSON.stringify(knowledgeBaseIds);
    }
    if (promptConfig) {
      mcpEnv.OC_PROMPT_NODE_ID = promptConfig.nodeId;
      mcpEnv.OC_PROMPT_RUN_ID = String(promptConfig.runId);
      mcpEnv.OC_PROMPT_SENDER = promptConfig.senderNode;
      if (promptConfig.description) mcpEnv.OC_PROMPT_DESCRIPTION = promptConfig.description;
    }
    mcpServers["openconclave-workflow"] = {
      command: "bun",
      args: ["run", workflowMcpPath],
      env: mcpEnv,
    };
  }

  try {
    const thinkingBlocks: ThinkingBlock[] = [];
    let resultOutput = "";
    let costUsd: number | undefined;
    let sessionId: string | undefined;

    const agentQuery = query({
      prompt,
      options: {
        cwd: ws.cwd,
        env: { ...process.env, ...env } as Record<string, string>,
        model: config.model && modelMap[config.model] ? modelMap[config.model] : undefined,
        systemPrompt: config.systemPrompt,
        maxTurns: config.maxTurns ?? 25,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: config.allowedTools?.length
          ? config.allowedTools
          : { type: "preset" as const, preset: "claude_code" as const },
        mcpServers,
        // Isolate agent from user's personal MCP servers (Gmail, Sknet, etc.)
        // Only servers explicitly passed in mcpServers above will be available.
        strictMcpConfig: true,
        resume: options.sessionId,
        thinking: { type: "enabled" as const, budgetTokens: 31999 },
      },
    });

    // Consume the async generator
    for await (const message of agentQuery) {
      const msg = message as SDKMessage & { type: string; subtype?: string; [key: string]: unknown };

      // Capture thinking blocks from assistant messages
      if (msg.type === "assistant") {
        const assistantMsg = msg as unknown as { message?: { content?: Array<{ type: string; thinking?: string; signature?: string }> } };
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === "thinking" && block.thinking) {
              thinkingBlocks.push({
                thinking: block.thinking,
                signature: block.signature,
              });
              onOutput?.(`[thinking: ${block.thinking.slice(0, 100)}...]\n`);
            }
          }
        }
      }

      // Capture result
      if (msg.type === "result") {
        const resultMsg = msg as unknown as {
          subtype?: string;
          result?: string;
          total_cost_usd?: number;
          session_id?: string;
          is_error?: boolean;
          errors?: string[];
        };
        if (resultMsg.subtype === "success") {
          resultOutput = resultMsg.result ?? "";
          costUsd = resultMsg.total_cost_usd;
          sessionId = resultMsg.session_id;
        } else {
          // Error result
          const errorMsg = resultMsg.errors?.join("\n") ?? "Agent failed";
          return {
            success: false,
            output: "",
            error: errorMsg,
            costUsd: resultMsg.total_cost_usd,
            durationMs: Date.now() - startTime,
            thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          };
        }
      }
    }

    const durationMs = Date.now() - startTime;

    // Read workflow state file for routing decisions
    let routeTo: string | undefined;
    if (stateFile) {
      try {
        if (existsSync(stateFile)) {
          const state = JSON.parse(readFileSync(stateFile, "utf8"));
          if (state.routeTo) {
            routeTo = state.routeTo;
            if (state.routeContent) {
              resultOutput = state.routeContent;
            }
          }
          unlinkSync(stateFile);
        }
      } catch {
        // State file not written — agent didn't call routing tool
      }
    }

    return {
      success: true,
      output: resultOutput,
      costUsd,
      durationMs,
      thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      routeTo,
      sessionId,
    };
  } catch (err: unknown) {
    // Clean up temp files on error
    if (stateFile) {
      try { unlinkSync(stateFile); } catch {}
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      error: message,
      durationMs: Date.now() - startTime,
    };
  }
}
