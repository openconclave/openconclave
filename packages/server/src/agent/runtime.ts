import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync, unlinkSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { AgentConfig } from "@openconclave/shared";
import { TMP_DIR } from "../lib/workspace";

// Agent working directory = where the server process was started
const AGENT_CWD = process.cwd();

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
  config: AgentConfig;
  routeTargets?: RouteTarget[];
  sessionId?: string;
  input?: unknown;
  cwd?: string;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
  onOutput?: (chunk: string) => void;
};

const modelMap: Record<string, string> = {
  sonnet: "sonnet",
  opus: "opus",
  haiku: "haiku",
};

// MCP server configs keyed by ID — matches the tool-picker on the client
const mcpServerConfigs: Record<string, { command: string; args: string[] }> = {
  playwright: {
    command: "npx",
    args: ["@playwright/mcp@latest"],
  },
  "telegram-voice": {
    command: "npx",
    args: ["@anthropic-ai/mcp-server-telegram-voice@latest"],
  },
  filesystem: {
    command: "npx",
    args: ["@anthropic-ai/mcp-server-filesystem@latest"],
  },
  fetch: {
    command: "npx",
    args: ["@anthropic-ai/mcp-server-fetch@latest"],
  },
};

export async function runClaudeAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { config, input, cwd, env, abortSignal, onOutput } = options;
  const startTime = Date.now();

  // Build the prompt
  let prompt: string;
  if (input !== undefined && input !== null && input !== "") {
    prompt = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } else {
    prompt = "Start";
  }

  // Build MCP server config
  const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  if (config.mcpServers?.length) {
    for (const serverId of config.mcpServers) {
      const serverConf = mcpServerConfigs[serverId];
      if (serverConf) {
        mcpServers[serverId] = serverConf;
      }
    }
  }

  // Add OpenConclave workflow MCP server for routing
  const routeTargets = options.routeTargets;
  let stateFile: string | null = null;

  if (routeTargets && routeTargets.length >= 2) {
    const tmpDir = TMP_DIR;
    mkdirSync(tmpDir, { recursive: true });
    stateFile = join(tmpDir, `state-${Date.now()}.json`);

    const workflowMcpPath = resolve(import.meta.dir, "workflow-mcp-server.ts");
    mcpServers["openconclave-workflow"] = {
      command: "bun",
      args: ["run", workflowMcpPath],
      env: {
        OC_STATE_FILE: stateFile,
        OC_ROUTE_TARGETS: JSON.stringify(routeTargets ?? []),
      },
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
        cwd: cwd ?? AGENT_CWD,
        env: { ...process.env, ...env } as Record<string, string>,
        model: config.model && modelMap[config.model] ? modelMap[config.model] : undefined,
        systemPrompt: config.systemPrompt,
        maxTurns: config.maxTurns ?? 25,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: config.allowedTools?.length
          ? config.allowedTools
          : { type: "preset" as const, preset: "claude_code" as const },
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
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
