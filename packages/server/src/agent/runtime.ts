import { spawn } from "bun";
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
  conversationHistory?: Array<{ role: string; content: string }>;
  input?: unknown;
  cwd?: string;
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
  const { config, input, cwd, abortSignal, onOutput } = options;
  const startTime = Date.now();

  // Build the prompt — just the current user message
  let prompt: string;
  if (input !== undefined && input !== null && input !== "") {
    prompt = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } else {
    prompt = "Start";
  }

  // Build CLI args — use stream-json to capture thinking blocks
  const args: string[] = [
    "--print",
    "--verbose",
    "--output-format", "stream-json",
    "--max-thinking-tokens", "31999",
    "--dangerously-skip-permissions",
  ];

  // Resume existing session for multi-turn conversations
  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  if (config.model && modelMap[config.model]) {
    args.push("--model", modelMap[config.model]);
  }

  if (config.systemPrompt) {
    args.push("--system-prompt", config.systemPrompt);
  }

  if (config.maxBudgetUsd) {
    args.push("--max-budget-usd", String(config.maxBudgetUsd));
  }

  // Built-in tools
  if (config.allowedTools?.length) {
    args.push("--allowedTools", config.allowedTools.join(","));
  }

  // MCP servers + routing — write a temp config file and pass via --mcp-config
  let mcpConfigPath: string | null = null;
  const mcpConfig: Record<string, unknown> = { mcpServers: {} as Record<string, unknown> };
  const mcpServers = mcpConfig.mcpServers as Record<string, unknown>;

  // Add configured MCP servers
  if (config.mcpServers?.length) {
    for (const serverId of config.mcpServers) {
      const serverConf = mcpServerConfigs[serverId];
      if (serverConf) {
        mcpServers[serverId] = serverConf;
      }
    }
  }

  // Add OpenConclave workflow MCP server for routing + history
  const routeTargets = options.routeTargets;
  const conversationHistory = options.conversationHistory;
  let stateFile: string | null = null;

  const needsWorkflowMcp = (routeTargets && routeTargets.length >= 2) ||
    (conversationHistory && conversationHistory.length > 0);

  if (needsWorkflowMcp) {
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
        OC_CONVERSATION_HISTORY: JSON.stringify(conversationHistory ?? []),
      },
    };
  }

  if (Object.keys(mcpServers).length > 0) {
    const tmpDir = TMP_DIR;
    mkdirSync(tmpDir, { recursive: true });
    mcpConfigPath = join(tmpDir, `mcp-${Date.now()}.json`);
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
    args.push("--mcp-config", mcpConfigPath);
  }

  // Pass prompt via stdin to avoid CLI argument parsing issues with --mcp-config
  try {
    const proc = spawn({
      cmd: ["claude", ...args],
      cwd: cwd ?? AGENT_CWD,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    // Handle abort
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        proc.kill();
      });
    }

    // Collect stdout — stream-json emits one JSON object per line
    const lines: string[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);

      // Process complete lines
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        lines.push(line);

        try {
          const msg = JSON.parse(line);

          // Capture thinking blocks from assistant messages
          if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
            for (const block of msg.message.content) {
              if (block.type === "thinking" && block.thinking) {
                thinkingBlocks.push({
                  thinking: block.thinking,
                  signature: block.signature,
                });
                onOutput?.(`[thinking: ${block.thinking.slice(0, 100)}...]\n`);
              }
            }
          }
        } catch {
          // Not JSON, skip
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) lines.push(buffer.trim());

    // Collect stderr
    let stderr = "";
    const errReader = proc.stderr.getReader();
    while (true) {
      const { done, value } = await errReader.read();
      if (done) break;
      stderr += decoder.decode(value);
    }

    const exitCode = await proc.exited;
    const durationMs = Date.now() - startTime;

    // Clean up temp MCP config
    if (mcpConfigPath) {
      try { unlinkSync(mcpConfigPath); } catch {}
    }

    if (exitCode !== 0) {
      return {
        success: false,
        output: lines.join("\n"),
        error: stderr || `claude exited with code ${exitCode}`,
        durationMs,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      };
    }

    // Parse the result message (last line with type "result")
    let parsedOutput = "";
    let costUsd: number | undefined;
    let sessionId: string | undefined;

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "result") {
          parsedOutput = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
          costUsd = msg.total_cost_usd;
          sessionId = msg.session_id;
        }
      } catch {
        // skip
      }
    }

    if (!parsedOutput) {
      // Fallback — try raw join
      parsedOutput = lines.join("\n");
    }

    // Read workflow state file for routing decisions
    let routeTo: string | undefined;
    if (stateFile) {
      try {
        if (existsSync(stateFile)) {
          const state = JSON.parse(readFileSync(stateFile, "utf8"));
          if (state.routeTo) {
            routeTo = state.routeTo;
            if (state.routeContent) {
              parsedOutput = state.routeContent;
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
      output: parsedOutput,
      costUsd,
      durationMs,
      thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      routeTo,
      sessionId,
    };
  } catch (err: any) {
    // Clean up temp files on error
    if (mcpConfigPath) {
      try { unlinkSync(mcpConfigPath); } catch {}
    }
    if (stateFile) {
      try { unlinkSync(stateFile); } catch {}
    }

    return {
      success: false,
      output: "",
      error: err.message ?? String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
