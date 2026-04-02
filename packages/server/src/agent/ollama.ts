/**
 * Ollama agent runtime — public entry point.
 *
 * Types:    ollama-types.ts
 * Tools:    ollama-tools.ts
 * Routing:  ollama-routing.ts
 */

import { spawn } from "bun";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";
import { McpBridge } from "./mcp-bridge";
import { SESSIONS_DIR } from "../lib/workspace";
import { createOllamaBuiltinTools } from "./ollama-tools";
import { createOllamaRoutingTool } from "./ollama-routing";

export type { OllamaStatus, OllamaRunOptions, ThinkingBlock, OllamaResult } from "./ollama-types";
import type { OllamaTool, OllamaRunOptions, OllamaResult, OllamaStatus, ThinkingBlock } from "./ollama-types";

// ── Debug logging ─────────────────────────────────────────────

const DEBUG = process.env.OPENCONCLAVE_DEBUG === "1";
const OLLAMA_LOG = join(SESSIONS_DIR, "ollama-debug.log");

function ollamaLog(label: string, data: unknown): void {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${label}: ${JSON.stringify(data, null, 2)}\n`;
  try {
    appendFileSync(OLLAMA_LOG, line);
  } catch { /* ignore write failures */ }
}

// ── Ollama URL ────────────────────────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

// ── Status check ──────────────────────────────────────────────

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

// ── Agent runtime loop ────────────────────────────────────────

export async function runOllamaAgent(options: OllamaRunOptions): Promise<OllamaResult> {
  const { model, abortSignal, onOutput } = options;
  const maxTurns = options.maxTurns ?? 10;
  const startTime = Date.now();

  // Read messages from session file (managed by executor)
  const sessionFile = options.sessionFile;
  const messages: Array<{ role: string; content: string }> = [];

  if (sessionFile && existsSync(sessionFile)) {
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch { /* skip malformed lines */ }
    }
  } else {
    // Fallback: no session file — build minimal messages
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    const inputStr =
      options.input !== undefined
        ? typeof options.input === "string"
          ? options.input
          : JSON.stringify(options.input, null, 2)
        : options.prompt || "Start";
    messages.push({ role: "user", content: inputStr });
  }

  // Collect requested built-in tools — pass cwd for file/process isolation
  const builtinTools = createOllamaBuiltinTools(options.cwd);
  const requestedTools = options.tools ?? [];
  const activeTools: OllamaTool[] = [];
  const toolExecutors = new Map<string, (args: Record<string, unknown>) => Promise<string>>();

  for (const toolId of requestedTools) {
    if (toolId === "openconclave_next") continue; // handled below
    const bt = builtinTools[toolId];
    if (bt) {
      activeTools.push(bt.tool);
      toolExecutors.set(bt.tool.function.name, bt.execute);
    }
  }

  // Add routing tool with actual route targets
  if (options.routeTargets && options.routeTargets.length >= 2) {
    const routingTool = createOllamaRoutingTool(options.routeTargets);
    activeTools.push(routingTool.tool);
    toolExecutors.set("openconclave_next", routingTool.execute);
  }

  // Connect MCP servers and discover their tools
  let mcpBridge: McpBridge | null = null;
  const mcpServers = options.mcpServers ?? [];

  if (mcpServers.length > 0) {
    mcpBridge = new McpBridge();
    try {
      await mcpBridge.connect(mcpServers);
      for (const tool of mcpBridge.getTools()) {
        activeTools.push(tool);
        const toolName = tool.function.name;
        toolExecutors.set(toolName, async (args) => mcpBridge!.callTool(toolName, args));
      }
      onOutput?.(
        `[Connected MCP servers: ${mcpServers.join(", ")} — ${mcpBridge.getTools().length} tools available]\n`,
      );
    } catch (err: unknown) {
      onOutput?.(
        `[Failed to connect MCP servers: ${err instanceof Error ? err.message : String(err)}]\n`,
      );
    }
  }

  const hasTools = activeTools.length > 0;
  const thinkingBlocks: ThinkingBlock[] = [];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: false,
        think: options.thinking ?? true,
      };

      if (hasTools) {
        body.tools = activeTools;
      }

      ollamaLog(`REQUEST turn ${turn + 1}`, {
        model,
        messages,
        tools: hasTools ? activeTools : undefined,
      });

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortSignal,
      });

      if (!res.ok) {
        const errText = await res.text();
        if (mcpBridge) await mcpBridge.disconnect();
        return {
          success: false,
          output: "",
          error: `Ollama API error ${res.status}: ${errText}`,
          durationMs: Date.now() - startTime,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assistantMsg = data.message as any;
      ollamaLog(`RESPONSE turn ${turn + 1}`, {
        thinking: assistantMsg.thinking?.slice(0, 500),
        content: assistantMsg.content?.slice(0, 500),
        tool_calls: assistantMsg.tool_calls,
      });

      // Capture thinking/reasoning from the response
      if (assistantMsg.thinking) {
        thinkingBlocks.push({ thinking: assistantMsg.thinking });
        onOutput?.(`[thinking: ${(assistantMsg.thinking as string).slice(0, 100)}...]\n`);
      }

      // Add assistant message to history — include thinking so model remembers its reasoning on resume
      const savedMsg = { ...assistantMsg };
      if (assistantMsg.thinking && !assistantMsg.content?.includes(assistantMsg.thinking)) {
        savedMsg.content = `<think>${assistantMsg.thinking}</think>\n${assistantMsg.content ?? ""}`;
      }
      messages.push(savedMsg);

      // Check if the model wants to call tools
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((assistantMsg.tool_calls as any[])?.length > 0) {
        onOutput?.(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `[Tool calls: ${(assistantMsg.tool_calls as any[]).map((tc: any) => tc.function.name).join(", ")}]\n`,
        );

        let routeTo: string | undefined;
        let routeContent: string | undefined;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const toolCall of assistantMsg.tool_calls as any[]) {
          const fnName = toolCall.function.name as string;
          const fnArgs = toolCall.function.arguments as Record<string, unknown>;

          // Capture routing before executing
          if (fnName === "openconclave_next" && fnArgs?.node_id) {
            routeTo = fnArgs.node_id as string;
            routeContent = (fnArgs.content as string) ?? "";
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
          messages.push({ role: "tool", content: result });

          onOutput?.(`[${fnName} result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}]\n`);
        }

        // If agent routed, return immediately with the route info
        if (routeTo) {
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
      const output: string = assistantMsg.content ?? "";
      onOutput?.(output);

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
  } catch (err: unknown) {
    if (mcpBridge) await mcpBridge.disconnect();
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
