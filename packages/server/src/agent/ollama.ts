import { spawn } from "bun";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { McpBridge } from "./mcp-bridge";
import { logger } from "../lib/logger";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  models: string[];
};

export async function checkOllama(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { installed: true, running: false, models: [] };

    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);

    return { installed: true, running: true, models };
  } catch {
    try {
      const proc = spawn({ cmd: ["ollama", "--version"], stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return { installed: true, running: false, models: [] };
    } catch {
      return { installed: false, running: false, models: [] };
    }
  }
}

// ── Tool definitions for Ollama ──────────────────────────────

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// Built-in tools that Ollama agents can use
const builtinTools: Record<string, { tool: OllamaTool; execute: (args: any) => Promise<string> }> = {
  bash: {
    tool: {
      type: "function",
      function: {
        name: "bash",
        description: "Run a shell command and return its output",
        parameters: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string", description: "The shell command to execute" },
          },
        },
      },
    },
    execute: async (args: { command: string }) => {
      try {
        const proc = spawn({
          cmd: ["bash", "-c", args.command],
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        return exitCode === 0
          ? stdout || "(no output)"
          : `Error (exit ${exitCode}): ${stderr || stdout}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
  read_file: {
    tool: {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file",
        parameters: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string", description: "Absolute or relative file path" },
          },
        },
      },
    },
    execute: async (args: { path: string }) => {
      try {
        const file = Bun.file(args.path);
        return await file.text();
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
  write_file: {
    tool: {
      type: "function",
      function: {
        name: "write_file",
        description: "Write content to a file",
        parameters: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string", description: "File path to write to" },
            content: { type: "string", description: "Content to write" },
          },
        },
      },
    },
    execute: async (args: { path: string; content: string }) => {
      try {
        await Bun.write(args.path, args.content);
        return `File written: ${args.path}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
  web_fetch: {
    tool: {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch content from a URL and return the text",
        parameters: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", description: "The URL to fetch" },
          },
        },
      },
    },
    execute: async (args: { url: string }) => {
      try {
        const res = await fetch(args.url, { signal: AbortSignal.timeout(15000) });
        const text = await res.text();
        // Truncate large responses
        return text.length > 8000 ? text.slice(0, 8000) + "\n...(truncated)" : text;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
  send_telegram: {
    tool: {
      type: "function",
      function: {
        name: "send_telegram",
        description: "Send a message to a Telegram chat",
        parameters: {
          type: "object",
          required: ["chat_id", "text"],
          properties: {
            chat_id: { type: "string", description: "Telegram chat ID" },
            text: { type: "string", description: "Message text to send" },
          },
        },
      },
    },
    execute: async (args: { chat_id: string; text: string }) => {
      // Use the telegram-voice MCP tool via internal HTTP call
      try {
        // Try calling our own server's MCP or use the bot token directly
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) return "Error: TELEGRAM_BOT_TOKEN not set in environment";

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: args.chat_id, text: args.text }),
        });
        const data = await res.json() as any;
        return data.ok ? `Message sent (id: ${data.result?.message_id})` : `Error: ${data.description}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
  openconclave_next: {
    tool: {
      type: "function",
      function: {
        name: "openconclave_next",
        description: "Route to the next workflow step. You MUST call this to choose which node to execute next.",
        parameters: {
          type: "object",
          required: ["node_id", "content"],
          properties: {
            node_id: { type: "string", description: "The ID of the next node to route to" },
            content: { type: "string", description: "Your output message to pass to the next node" },
          },
        },
      },
    },
    execute: async (args: { node_id: string; content: string }) => {
      // The executor handles routing — this just returns the route info
      return `ROUTE:${args.node_id}:${args.content}`;
    },
  },
};

// ── Ollama agent runtime with tool calling ───────────────────

export type OllamaRunOptions = {
  model: string;
  prompt: string;
  systemPrompt?: string;
  input?: unknown;
  tools?: string[];
  mcpServers?: string[];
  sessionFile?: string;
  thinking?: boolean;
  maxTurns?: number;
  abortSignal?: AbortSignal;
  onOutput?: (chunk: string) => void;
};

export interface ThinkingBlock {
  thinking: string;
}

export interface OllamaResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  thinking?: ThinkingBlock[];
  sessionId?: string;
  routeTo?: string;
}

export async function runOllamaAgent(options: OllamaRunOptions): Promise<OllamaResult> {
  const { model, prompt, systemPrompt, input, abortSignal, onOutput } = options;
  const maxTurns = options.maxTurns ?? 10;
  const startTime = Date.now();

  // Build messages — restore from session file or start fresh
  const sessionFile = options.sessionFile;
  const messages: Array<{ role: string; content: string }> = [];

  if (sessionFile && existsSync(sessionFile)) {
    // Resume: read previous messages from session file
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch { /* skip malformed */ }
    }
  } else {
    // First turn: add system prompt
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
  }

  // Add current user message
  if (input !== undefined) {
    const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    messages.push({ role: "user", content: inputStr });
  } else if (messages.length <= 1) {
    // No input and no history — use prompt as first message
    messages.push({ role: "user", content: prompt || "Start" });
  }

  // Collect requested built-in tools
  const requestedTools = options.tools ?? [];
  const activeTools: OllamaTool[] = [];
  const toolExecutors = new Map<string, (args: any) => Promise<string>>();

  for (const toolId of requestedTools) {
    const bt = builtinTools[toolId];
    if (bt) {
      activeTools.push(bt.tool);
      toolExecutors.set(bt.tool.function.name, bt.execute);
    }
  }

  // Connect MCP servers and discover their tools
  let mcpBridge: McpBridge | null = null;
  const mcpServers = options.mcpServers ?? [];

  if (mcpServers.length > 0) {
    mcpBridge = new McpBridge();
    try {
      await mcpBridge.connect(mcpServers);
      // Add MCP tools to active tools
      for (const tool of mcpBridge.getTools()) {
        activeTools.push(tool);
        // Register MCP tool executor
        const toolName = tool.function.name;
        toolExecutors.set(toolName, async (args: any) => {
          return mcpBridge!.callTool(toolName, args);
        });
      }
      onOutput?.(`[Connected MCP servers: ${mcpServers.join(", ")} — ${mcpBridge.getTools().length} tools available]\n`);
    } catch (err: any) {
      onOutput?.(`[Failed to connect MCP servers: ${err.message}]\n`);
    }
  }

  const hasTools = activeTools.length > 0;

  const thinkingBlocks: ThinkingBlock[] = [];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const body: any = {
        model,
        messages,
        stream: false,
        think: options.thinking ?? true,
      };

      if (hasTools) {
        body.tools = activeTools;
      }

      logger.debug(`Ollama turn ${turn + 1}`, { model, messages: messages.length });

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortSignal,
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          success: false,
          output: "",
          error: `Ollama API error ${res.status}: ${errText}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = await res.json() as any;
      const assistantMsg = data.message;

      // Capture thinking/reasoning from the response
      if (assistantMsg.thinking) {
        thinkingBlocks.push({ thinking: assistantMsg.thinking });
        onOutput?.(`[thinking: ${assistantMsg.thinking.slice(0, 100)}...]\n`);
      }

      // Add assistant message to history
      messages.push(assistantMsg);

      // Check if the model wants to call tools
      if (assistantMsg.tool_calls?.length > 0) {
        onOutput?.(`[Tool calls: ${assistantMsg.tool_calls.map((tc: any) => tc.function.name).join(", ")}]\n`);

        let routeTo: string | undefined;
        let routeContent: string | undefined;

        for (const toolCall of assistantMsg.tool_calls) {
          const fnName = toolCall.function.name;
          const fnArgs = toolCall.function.arguments;

          // Capture routing before executing
          if (fnName === "openconclave_next" && fnArgs?.node_id) {
            routeTo = fnArgs.node_id;
            routeContent = fnArgs.content ?? "";
          }

          const executor = toolExecutors.get(fnName);

          let result: string;
          if (executor) {
            onOutput?.(`[Executing ${fnName}...]\n`);
            result = await executor(fnArgs);
          } else {
            result = `Error: Unknown tool "${fnName}"`;
          }

          // Add tool result to messages
          messages.push({
            role: "tool",
            content: result,
          });

          onOutput?.(`[${fnName} result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}]\n`);
        }

        // If agent routed, return immediately with the route info
        if (routeTo) {
          if (sessionFile) {
            mkdirSync(dirname(sessionFile), { recursive: true });
            const linesToSave = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
            writeFileSync(sessionFile, linesToSave);
          }
          if (mcpBridge) await mcpBridge.disconnect();
          return {
            success: true,
            output: routeContent ?? "",
            routeTo,
            durationMs: Date.now() - startTime,
            thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          };
        }

        // Continue the loop — model will process tool results
        continue;
      }

      // No tool calls — model produced a final text response
      const output = assistantMsg.content ?? "";
      onOutput?.(output);

      // Save session to file for resume on next turn
      if (sessionFile) {
        mkdirSync(dirname(sessionFile), { recursive: true });
        const linesToSave = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
        writeFileSync(sessionFile, linesToSave);
      }

      if (mcpBridge) await mcpBridge.disconnect();
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      };
    }

    // Exceeded max turns
    if (mcpBridge) await mcpBridge.disconnect();
    return {
      success: false,
      output: "",
      error: `Exceeded max turns (${maxTurns})`,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    if (mcpBridge) await mcpBridge.disconnect();
    return {
      success: false,
      output: "",
      error: err.message ?? String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
