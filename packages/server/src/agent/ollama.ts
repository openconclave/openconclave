/**
 * Ollama agent runtime — public entry point.
 *
 * Types:    ollama-types.ts
 * Tools:    base.ts (AgentBase resolves builtin + knowledge + MCP tools)
 * Routing:  ollama-routing.ts
 */

import { spawn } from "bun";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";
import { SESSIONS_DIR } from "../lib/workspace";
import { AgentBase } from "./base";
import { createOllamaRoutingTool } from "./ollama-routing";
import { ROUTING_TOOL_NAME } from "./constants";
import type { ResolvedAgentConfig } from "@openconclave/shared";

export type { OllamaStatus, OllamaModelInfo, OllamaRunOptions, ThinkingBlock, OllamaResult } from "./ollama-types";
import type { OllamaTool, OllamaRunOptions, OllamaResult, OllamaStatus, OllamaModelInfo, ThinkingBlock } from "./ollama-types";

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

    // Fetch capabilities for each model in parallel
    const modelDetails: OllamaModelInfo[] = await Promise.all(
      models.map(async (name) => {
        try {
          const showRes = await fetch(`${OLLAMA_URL}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: name }),
            signal: AbortSignal.timeout(3000),
          });
          if (showRes.ok) {
            const info = (await showRes.json()) as { capabilities?: string[] };
            return { name, capabilities: info.capabilities ?? [] };
          }
        } catch { /* ignore per-model failures */ }
        return { name, capabilities: [] };
      })
    );

    return { installed: true, running: true, models, modelDetails };
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

// ── Ollama streaming response reader ──────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readOllamaStream(res: Response, onOutput?: (text: string) => void): Promise<any> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let thinking = "";
  let content = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toolCalls: any[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let finalMsg: any = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunk = JSON.parse(line) as any;
        const msg = chunk.message;
        if (msg?.thinking) thinking += msg.thinking;
        if (msg?.content) {
          content += msg.content;
          onOutput?.(msg.content);
        }
        if (msg?.tool_calls) toolCalls = msg.tool_calls;
        if (chunk.done) finalMsg = chunk;
      } catch { /* skip malformed lines */ }
    }
  }

  if (buf.trim()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunk = JSON.parse(buf) as any;
      const msg = chunk.message;
      if (msg?.thinking) thinking += msg.thinking;
      if (msg?.content) content += msg.content;
      if (msg?.tool_calls) toolCalls = msg.tool_calls;
      if (chunk.done) finalMsg = chunk;
    } catch { /* skip */ }
  }

  return {
    role: "assistant",
    content: content || undefined,
    thinking: thinking || undefined,
    tool_calls: toolCalls,
    ...(finalMsg?.message ?? {}),
    // Override with accumulated values (streaming chunks are deltas)
    ...(content ? { content } : {}),
    ...(thinking ? { thinking } : {}),
  };
}

// ── Agent runtime loop ────────────────────────────────────────

export async function runOllamaAgent(options: OllamaRunOptions): Promise<OllamaResult> {
  const { model, abortSignal, onOutput } = options;
  const maxTurns = options.maxTurns ?? 25;
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
    // Append new input so the model sees the current turn, not just old history
    const inputStr =
      options.input !== undefined
        ? typeof options.input === "string"
          ? options.input
          : JSON.stringify(options.input, null, 2)
        : options.prompt || "";
    if (inputStr) {
      messages.push({ role: "user", content: inputStr });
    }
  } else {
    // No session file — build minimal messages
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

  // Resolve tools via AgentBase (builtin + knowledge + MCP)
  const resolvedConfig: ResolvedAgentConfig = {
    allowedTools: options.allowedTools ?? [],
    mcpServers: options.mcpServers ?? [],
    mcpTools: options.mcpTools,
    knowledgeBases: options.knowledgeBases ?? [],
  };
  const agent = new AgentBase(resolvedConfig, options.workspace, options.runId);
  await agent.connectMcpServers();

  const activeTools: OllamaTool[] = agent.toChatTools() as OllamaTool[];
  const toolExecutors = agent.toolExecutors;

  if (agent.tools.length > 0) {
    onOutput?.(`[Resolved ${agent.tools.length} tools via AgentBase]\n`);
  }

  // Add routing tool with actual route targets
  if (options.routeTargets && options.routeTargets.length >= 1) {
    const routingTool = createOllamaRoutingTool(options.routeTargets);
    activeTools.push(routingTool.tool);
    toolExecutors.set(ROUTING_TOOL_NAME, routingTool.execute);
  }

  // Register extra dynamic tools (e.g., ask_user for channel loops)
  if (options.extraTools) {
    for (const et of options.extraTools) {
      activeTools.push(et.tool);
      toolExecutors.set(et.tool.function.name, et.execute);
    }
  }

  const hasTools = activeTools.length > 0;
  const thinkingBlocks: ThinkingBlock[] = [];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        think: options.thinking ?? true,
        options: { num_ctx: 32768 },
      };

      if (hasTools) {
        body.tools = activeTools;
      }

      ollamaLog(`REQUEST turn ${turn + 1}`, {
        model,
        messages,
        tools: hasTools ? activeTools : undefined,
      });

      // Bun's fetch has a 30s default timeout — far too short for local LLM
      // inference (time-to-first-token on a 9B model with thinking can exceed 60s).
      // Combine the pool's cancellation signal with a 10-minute deadline.
      const timeoutSignal = AbortSignal.timeout(600_000);
      const fetchSignal = abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal;

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: fetchSignal,
      });

      if (!res.ok) {
        const errText = await res.text();
        await agent.disconnect();
        return {
          success: false,
          output: "",
          error: `Ollama API error ${res.status}: ${errText}`,
          durationMs: Date.now() - startTime,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assistantMsg = await readOllamaStream(res, onOutput) as any;
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
          let fnArgs: Record<string, unknown>;
          const rawArgs = toolCall.function.arguments;
          if (typeof rawArgs === "string") {
            try {
              fnArgs = JSON.parse(rawArgs);
            } catch {
              messages.push({ role: "tool", content: `Error: malformed JSON arguments for "${fnName}"` });
              continue;
            }
          } else {
            fnArgs = (rawArgs as Record<string, unknown>) ?? {};
          }

          // Capture routing before executing
          if (fnName === ROUTING_TOOL_NAME && fnArgs?.node_id) {
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
          await agent.disconnect();
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

      await agent.disconnect();
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      };
    }

    // Exceeded max turns
    await agent.disconnect();
    return {
      success: false,
      output: "",
      error: `Exceeded max turns (${maxTurns})`,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    await agent.disconnect();
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
