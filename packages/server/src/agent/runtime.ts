import { spawn } from "bun";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import type { AgentConfig } from "@openconclave/shared";

// Project root — two levels up from packages/server
const PROJECT_ROOT = resolve(import.meta.dir, "../../../");

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
}

export interface RouteTarget {
  nodeId: string;
  label: string;
  type: string;
}

export type AgentRunOptions = {
  config: AgentConfig;
  routeTargets?: RouteTarget[];
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

  // Build the prompt — inject input data if coming from a predecessor node
  let prompt = config.prompt;
  if (input !== undefined) {
    prompt = `## Input from previous step\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\n## Task\n${config.prompt}`;
  }

  // Build CLI args — use stream-json to capture thinking blocks
  const args: string[] = [
    "--print",
    "--verbose",
    "--output-format", "stream-json",
    "--max-thinking-tokens", "31999",
    "--dangerously-skip-permissions",
  ];

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

  // Add routing MCP server if agent has route targets
  const routeTargets = options.routeTargets;
  if (routeTargets && routeTargets.length >= 2) {
    const routeServerPath = resolve(import.meta.dir, "route-mcp-server.ts");
    mcpServers["openconclave-router"] = {
      command: "bun",
      args: ["run", routeServerPath],
      env: {
        ROUTE_TARGETS: JSON.stringify(routeTargets),
      },
    };
  }

  if (Object.keys(mcpServers).length > 0) {
    const tmpDir = join(process.cwd(), ".openconclave-tmp");
    mkdirSync(tmpDir, { recursive: true });
    mcpConfigPath = join(tmpDir, `mcp-${Date.now()}.json`);
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
    args.push("--mcp-config", mcpConfigPath);
  }

  // Pass prompt via stdin to avoid CLI argument parsing issues with --mcp-config
  try {
    const proc = spawn({
      cmd: ["claude", ...args],
      cwd: cwd ?? PROJECT_ROOT,
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

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "result") {
          parsedOutput = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
          costUsd = msg.total_cost_usd;
        }
      } catch {
        // skip
      }
    }

    if (!parsedOutput) {
      // Fallback — try raw join
      parsedOutput = lines.join("\n");
    }

    return {
      success: true,
      output: parsedOutput,
      costUsd,
      durationMs,
      thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
    };
  } catch (err: any) {
    // Clean up temp MCP config on error too
    if (mcpConfigPath) {
      try { unlinkSync(mcpConfigPath); } catch {}
    }

    return {
      success: false,
      output: "",
      error: err.message ?? String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
