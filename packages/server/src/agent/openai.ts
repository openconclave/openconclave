import { readFileSync, appendFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger";
import { SESSIONS_DIR } from "../lib/workspace";
import { createBuiltinTools, TOOL_NAME_MAP } from "./builtin-tools";
import { McpBridge } from "./mcp-bridge";

const OPENAI_LOG = join(SESSIONS_DIR, "openai-debug.log");
function openaiLog(label: string, data: unknown) {
  const line = `[${new Date().toISOString()}] ${label}: ${JSON.stringify(data, null, 2)}\n`;
  try { appendFileSync(OPENAI_LOG, line); } catch {}
}

// ── Provider config (stored in settings) ────────────────────

export interface OpenAIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** "responses" for OpenAI Responses API, "chat" for standard Chat Completions (default) */
  apiType?: "responses" | "chat";
  supportsModelList?: boolean;
}

// ── Tool definitions (same shape as Ollama tools) ───────────

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ── Runtime options ─────────────────────────────────────────

export interface OpenAIRunOptions {
  provider: OpenAIProvider;
  model: string;
  prompt?: string;
  systemPrompt?: string;
  input?: unknown;
  tools?: OpenAITool[];
  allowedTools?: string[];
  mcpServers?: string[];
  cwd?: string;
  routeTargets?: Array<{ nodeId: string; label: string; type: string }>;
  sessionFile?: string;
  maxTurns?: number;
  onOutput?: (chunk: string) => void;
}

export interface OpenAIResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  thinking?: Array<{ thinking: string }>;
  routeTo?: string;
  sessionId?: string;
}

// ── Routing tool factories ──────────────────────────────────

function routingParams(routeTargets: Array<{ nodeId: string; label: string; type: string }>) {
  const routeList = routeTargets
    .map((r) => `  - "${r.nodeId}" → ${r.label} (${r.type})`)
    .join("\n");
  const desc = `Route to the next workflow step. You MUST call this exactly once.\nAvailable routes:\n${routeList}`;
  const params = {
    type: "object" as const,
    required: ["node_id", "content"],
    properties: {
      node_id: { type: "string", enum: routeTargets.map((r) => r.nodeId), description: "The node ID to route to" },
      content: { type: "string", description: "Your output message to pass to the next node" },
    },
  };
  return { desc, params };
}

// Chat Completions format
function createRoutingToolChat(routeTargets: Array<{ nodeId: string; label: string; type: string }>): OpenAITool {
  const { desc, params } = routingParams(routeTargets);
  return { type: "function", function: { name: "openconclave_next", description: desc, parameters: params } };
}

// Responses API format
function createRoutingToolResponses(routeTargets: Array<{ nodeId: string; label: string; type: string }>): Record<string, unknown> {
  const { desc, params } = routingParams(routeTargets);
  return { type: "function", name: "openconclave_next", description: desc, parameters: params };
}

// ── Main runtime (dispatches to Responses or Chat Completions) ──

export async function runOpenAIAgent(options: OpenAIRunOptions): Promise<OpenAIResult> {
  if (options.provider.apiType === "responses") {
    return runResponsesAPI(options);
  }
  return runChatCompletions(options);
}

// ── Responses API runtime ───────────────────────────────────

async function runResponsesAPI(options: OpenAIRunOptions): Promise<OpenAIResult> {
  const { provider, model, sessionFile, onOutput } = options;
  const maxTurns = options.maxTurns ?? 10;
  const startTime = Date.now();

  // Build input array from session file
  const input: Array<Record<string, unknown>> = [];

  if (sessionFile && existsSync(sessionFile)) {
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        // Convert session messages to Responses API input format
        if (msg.role === "system") {
          // System prompt goes into instructions, skip here
        } else {
          input.push(msg);
        }
      } catch { /* skip malformed */ }
    }
  } else {
    const inputStr = options.input !== undefined
      ? (typeof options.input === "string" ? options.input : JSON.stringify(options.input, null, 2))
      : (options.prompt || "Start");
    input.push({ role: "user", content: inputStr });
  }

  // Build tools + executors
  const tools: Array<Record<string, unknown>> = [];
  const toolExecutors = new Map<string, (args: Record<string, unknown>) => Promise<string>>();

  // Add builtin tools based on allowedTools
  if (options.allowedTools?.length) {
    const builtins = createBuiltinTools(options.cwd);
    for (const toolName of options.allowedTools) {
      const mapped = TOOL_NAME_MAP[toolName];
      if (mapped && builtins[mapped]) {
        // Responses API tool format: name at top level, not nested under function
        const bt = builtins[mapped].tool;
        tools.push({ type: "function", name: bt.function.name, description: bt.function.description, parameters: bt.function.parameters });
        toolExecutors.set(bt.function.name, builtins[mapped].execute);
      }
    }
  }

  // Connect MCP servers
  let mcpBridge: McpBridge | null = null;
  if (options.mcpServers?.length) {
    mcpBridge = new McpBridge();
    try {
      await mcpBridge.connect(options.mcpServers);
      for (const tool of mcpBridge.getTools()) {
        // Convert Chat Completions format to Responses API format
        tools.push({ type: "function", name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters });
        const mcpToolName = tool.function.name;
        toolExecutors.set(mcpToolName, async (args) => {
          return mcpBridge!.callTool(mcpToolName, args);
        });
      }
    } catch (err: unknown) {
      logger.warn("Failed to connect MCP servers for Responses API", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Add routing tool
  if (options.routeTargets && options.routeTargets.length >= 2) {
    tools.push(createRoutingToolResponses(options.routeTargets));
  }

  const thinkingBlocks: Array<{ thinking: string }> = [];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const body: Record<string, unknown> = {
        model,
        input,
        reasoning: { effort: "medium", summary: "auto" },
      };

      if (options.systemPrompt) {
        body.instructions = options.systemPrompt;
      }

      if (tools.length > 0) {
        body.tools = tools;
      }

      openaiLog(`RESPONSES REQUEST turn ${turn + 1}`, { provider: provider.name, model, inputCount: input.length, tools: tools.length > 0 ? tools : undefined });

      const res = await fetch(`${provider.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          success: false,
          output: "",
          error: `${provider.name} Responses API error ${res.status}: ${errText}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = await res.json() as any;
      openaiLog(`RESPONSES RESPONSE turn ${turn + 1}`, {
        status: data.status,
        outputTypes: data.output?.map((o: any) => o.type),
        reasoning_tokens: data.usage?.output_tokens_details?.reasoning_tokens,
      });

      // Process output items
      let textOutput = "";
      let routeTo: string | undefined;
      let routeContent: string | undefined;
      let hasFunctionCalls = false;

      // Push ALL output items to input for next turn (reasoning items must accompany function_calls)
      const functionResults: Array<{ call_id: string; output: string }> = [];

      for (const item of (data.output ?? [])) {
        // Capture reasoning summaries
        if (item.type === "reasoning" && item.summary) {
          const summaryText = item.summary
            .filter((s: any) => s.type === "summary_text")
            .map((s: any) => s.text)
            .join("\n");
          if (summaryText) {
            thinkingBlocks.push({ thinking: summaryText });
            onOutput?.(`[reasoning: ${summaryText.slice(0, 100)}...]\n`);
          }
        }

        // Capture text output
        if (item.type === "message" && item.content) {
          for (const block of item.content) {
            if (block.type === "output_text") {
              textOutput += block.text;
            }
          }
        }

        // Execute function calls
        if (item.type === "function_call") {
          hasFunctionCalls = true;
          let fnArgs: Record<string, unknown>;
          try {
            fnArgs = typeof item.arguments === "string" ? JSON.parse(item.arguments) : item.arguments;
          } catch {
            fnArgs = {};
          }

          if (item.name === "openconclave_next" && fnArgs.node_id) {
            routeTo = fnArgs.node_id as string;
            routeContent = (fnArgs.content as string) ?? "";
          }

          const executor = toolExecutors.get(item.name);
          let result: string;
          if (item.name === "openconclave_next") {
            result = `Routing to: ${routeTo}`;
          } else if (executor) {
            onOutput?.(`[Executing ${item.name}...]\n`);
            result = await executor(fnArgs);
            onOutput?.(`[${item.name} result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}]\n`);
          } else {
            result = `Unknown tool: ${item.name}`;
          }

          functionResults.push({ call_id: item.call_id, output: result });
        }

        // Add every output item to input (reasoning + function_call + message)
        input.push(item);
      }

      // Append function call results after all output items
      for (const fr of functionResults) {
        input.push({ type: "function_call_output", call_id: fr.call_id, output: fr.output });
      }

      if (routeTo) {
        if (mcpBridge) await mcpBridge.disconnect();
        return {
          success: true,
          output: routeContent ?? "",
          durationMs: Date.now() - startTime,
          thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          routeTo,
          sessionId: sessionFile,
        };
      }

      if (hasFunctionCalls) {
        continue;
      }

      // Final text response
      if (textOutput) {
        onOutput?.(textOutput);
      }

      if (mcpBridge) await mcpBridge.disconnect();
      return {
        success: true,
        output: textOutput || data.output_text || "",
        durationMs: Date.now() - startTime,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
        sessionId: sessionFile,
      };
    }

    return {
      success: false,
      output: "",
      error: `Max turns (${maxTurns}) reached`,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      error: message,
      durationMs: Date.now() - startTime,
    };
  }
}

// ── Chat Completions runtime ────────────────────────────────

async function runChatCompletions(options: OpenAIRunOptions): Promise<OpenAIResult> {
  const { provider, model, sessionFile, onOutput } = options;
  const maxTurns = options.maxTurns ?? 10;
  const startTime = Date.now();

  // Read messages from session file (managed by executor)
  const messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }> = [];

  if (sessionFile && existsSync(sessionFile)) {
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch { /* skip malformed */ }
    }
  } else {
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    const inputStr = options.input !== undefined
      ? (typeof options.input === "string" ? options.input : JSON.stringify(options.input, null, 2))
      : (options.prompt || "Start");
    messages.push({ role: "user", content: inputStr });
  }

  // Build tools list + executors
  const activeTools: OpenAITool[] = [...(options.tools ?? [])];
  const toolExecutors = new Map<string, (args: Record<string, unknown>) => Promise<string>>();

  // Add builtin tools (bash, read_file, etc.) based on allowedTools
  if (options.allowedTools?.length) {
    const builtins = createBuiltinTools(options.cwd);
    for (const toolName of options.allowedTools) {
      const mapped = TOOL_NAME_MAP[toolName];
      if (mapped && builtins[mapped]) {
        activeTools.push(builtins[mapped].tool as OpenAITool);
        toolExecutors.set(mapped, builtins[mapped].execute);
      }
    }
  }

  // Add routing tool
  if (options.routeTargets && options.routeTargets.length >= 2) {
    activeTools.push(createRoutingToolChat(options.routeTargets));
  }

  // Connect MCP servers
  let mcpBridge: McpBridge | null = null;
  if (options.mcpServers?.length) {
    mcpBridge = new McpBridge();
    try {
      await mcpBridge.connect(options.mcpServers);
      for (const tool of mcpBridge.getTools()) {
        activeTools.push(tool as OpenAITool);
        const mcpToolName = tool.function.name;
        toolExecutors.set(mcpToolName, async (args) => {
          return mcpBridge!.callTool(mcpToolName, args);
        });
      }
    } catch (err: unknown) {
      logger.warn("Failed to connect MCP servers", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const thinkingBlocks: Array<{ thinking: string }> = [];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const body: Record<string, unknown> = {
        model,
        messages,
      };

      if (activeTools.length > 0) {
        body.tools = activeTools;
      }

      openaiLog(`CHAT REQUEST turn ${turn + 1}`, { provider: provider.name, model, messageCount: messages.length, toolCount: activeTools.length });

      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (mcpBridge) await mcpBridge.disconnect();
        return {
          success: false,
          output: "",
          error: `${provider.name} API error ${res.status}: ${errText}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = await res.json() as any;
      const choice = data.choices?.[0];
      if (!choice) {
        if (mcpBridge) await mcpBridge.disconnect();
        return {
          success: false,
          output: "",
          error: "No choices in response",
          durationMs: Date.now() - startTime,
        };
      }

      const assistantMsg = choice.message;
      const reasoning = assistantMsg.reasoning_content ?? assistantMsg.reasoning ?? null;
      openaiLog(`CHAT RESPONSE turn ${turn + 1}`, { content: assistantMsg.content?.slice(0, 500), reasoning: reasoning?.slice(0, 500), tool_calls: assistantMsg.tool_calls });

      if (reasoning) {
        thinkingBlocks.push({ thinking: reasoning });
        onOutput?.(`[reasoning: ${reasoning.slice(0, 100)}...]\n`);
      }

      messages.push(assistantMsg);

      if (assistantMsg.tool_calls?.length > 0) {
        onOutput?.(`[Tool calls: ${assistantMsg.tool_calls.map((tc: any) => tc.function.name).join(", ")}]\n`);

        let routeTo: string | undefined;
        let routeContent: string | undefined;

        for (const toolCall of assistantMsg.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs: Record<string, unknown>;
          try {
            fnArgs = typeof toolCall.function.arguments === "string"
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
          } catch {
            fnArgs = {};
          }

          // Check for routing
          if (fnName === "openconclave_next" && fnArgs.node_id) {
            routeTo = fnArgs.node_id as string;
            routeContent = (fnArgs.content as string) ?? "";
          }

          // Execute tool
          const executor = toolExecutors.get(fnName);
          let result: string;
          if (fnName === "openconclave_next") {
            result = `Routing to: ${routeTo}`;
          } else if (executor) {
            onOutput?.(`[Executing ${fnName}...]\n`);
            result = await executor(fnArgs);
            onOutput?.(`[${fnName} result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}]\n`);
          } else {
            result = `Unknown tool: ${fnName}`;
          }

          messages.push({
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        if (routeTo) {
          if (mcpBridge) await mcpBridge.disconnect();
          return {
            success: true,
            output: routeContent ?? "",
            durationMs: Date.now() - startTime,
            thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
            routeTo,
            sessionId: sessionFile,
          };
        }

        continue;
      }

      const output = assistantMsg.content ?? "";
      onOutput?.(output);

      if (mcpBridge) await mcpBridge.disconnect();
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
        sessionId: sessionFile,
      };
    }

    return {
      success: false,
      output: "",
      error: `Max turns (${maxTurns}) reached`,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      error: message,
      durationMs: Date.now() - startTime,
    };
  }
}

// ── List models from provider ───────────────────────────────

export async function listOpenAIModels(provider: OpenAIProvider): Promise<string[]> {
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: { "Authorization": `Bearer ${provider.apiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.data ?? []).map((m: any) => m.id as string).sort();
  } catch {
    return [];
  }
}
