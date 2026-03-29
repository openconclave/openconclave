import { spawn } from "bun";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import type { AgentConfig } from "@openconclave/shared";

// Project root — two levels up from packages/server
const PROJECT_ROOT = resolve(import.meta.dir, "../../../");

export type AgentResult = {
  success: boolean;
  output: string;
  error?: string;
  costUsd?: number;
  durationMs: number;
};

export type AgentRunOptions = {
  config: AgentConfig;
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

  // Build CLI args
  const args: string[] = [
    "--print",
    "--output-format", "json",
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

  // MCP servers — write a temp config file and pass via --mcp-config
  let mcpConfigPath: string | null = null;

  if (config.mcpServers?.length) {
    const mcpConfig: Record<string, any> = { mcpServers: {} };

    for (const serverId of config.mcpServers) {
      const serverConf = mcpServerConfigs[serverId];
      if (serverConf) {
        mcpConfig.mcpServers[serverId] = serverConf;
      }
    }

    if (Object.keys(mcpConfig.mcpServers).length > 0) {
      // Write temp MCP config
      const tmpDir = join(process.cwd(), ".openconclave-tmp");
      mkdirSync(tmpDir, { recursive: true });
      mcpConfigPath = join(tmpDir, `mcp-${Date.now()}.json`);
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
      args.push("--mcp-config", mcpConfigPath);
    }
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

    // Collect stdout
    let stdout = "";
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      stdout += chunk;
      onOutput?.(chunk);
    }

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
        output: stdout,
        error: stderr || `claude exited with code ${exitCode}`,
        durationMs,
      };
    }

    // Try to parse the JSON output to extract result and cost
    let parsedOutput = stdout;
    let costUsd: number | undefined;

    try {
      const json = JSON.parse(stdout);
      if (json.result !== undefined) {
        parsedOutput = typeof json.result === "string" ? json.result : JSON.stringify(json.result);
      }
      if (json.total_cost_usd !== undefined) {
        costUsd = json.total_cost_usd;
      }
    } catch {
      // Not valid JSON, use raw output
    }

    return {
      success: true,
      output: parsedOutput,
      costUsd,
      durationMs,
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
