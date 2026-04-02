import { readFileSync, existsSync } from "fs";
import { logger } from "../lib/logger";
import { createBuiltinTools, TOOL_NAME_MAP } from "./builtin-tools";
import { McpBridge } from "./mcp-bridge";
import { openaiLog } from "./openai-debug";
import { createRoutingToolResponses } from "./openai-routing-tools";
import type { OpenAIRunOptions, OpenAIResult } from "./openai-types";

/**
 * Runs the OpenAI Responses API agentic loop.
 * Handles multi-turn reasoning, function calling, MCP bridges, and routing.
 */
export async function runResponsesAPI(options: OpenAIRunOptions): Promise<OpenAIResult> {
  const { provider, model, sessionFile, onOutput } = options;
  const maxTurns = options.maxTurns ?? 10;
  const startTime = Date.now();

  // Build input array from session file
  const input: Array<Record<string, unknown>> = [];

  if (sessionFile && existsSync(sessionFile)) {
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        // System prompt goes into instructions on the request body — skip here
        if (msg.role !== "system") {
          input.push(msg);
        }
      } catch { /* skip malformed lines */ }
    }
  } else {
    const inputStr =
      options.input !== undefined
        ? (typeof options.input === "string" ? options.input : JSON.stringify(options.input, null, 2))
        : (options.prompt ?? "Start");
    input.push({ role: "user", content: inputStr });
  }

  // Build tools list + executors
  const tools: Array<Record<string, unknown>> = [];
  const toolExecutors = new Map<string, (args: Record<string, unknown>) => Promise<string>>();

  if (options.allowedTools?.length) {
    const builtins = createBuiltinTools(options.cwd);
    for (const toolName of options.allowedTools) {
      const mapped = TOOL_NAME_MAP[toolName];
      if (mapped && builtins[mapped]) {
        const bt = builtins[mapped].tool;
        // Responses API uses name/description at top level, not nested under `function`
        tools.push({
          type: "function",
          name: bt.function.name,
          description: bt.function.description,
          parameters: bt.function.parameters,
        });
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
        tools.push({
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        });
        const mcpToolName = tool.function.name;
        toolExecutors.set(mcpToolName, async (args) => mcpBridge!.callTool(mcpToolName, args));
      }
    } catch (err: unknown) {
      logger.warn("Failed to connect MCP servers for Responses API", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Add routing tool if workflow has ≥2 branches
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

      openaiLog(`RESPONSES REQUEST turn ${turn + 1}`, {
        provider: provider.name,
        model,
        inputCount: input.length,
        tools: tools.length > 0 ? tools : undefined,
      });

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      openaiLog(`RESPONSES RESPONSE turn ${turn + 1}`, {
        status: data.status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputTypes: data.output?.map((o: any) => o.type),
        reasoning_tokens: data.usage?.output_tokens_details?.reasoning_tokens,
      });

      // Process output items
      let textOutput = "";
      let routeTo: string | undefined;
      let routeContent: string | undefined;
      let hasFunctionCalls = false;

      // Reasoning items must stay in input alongside function_calls for the next turn
      const functionResults: Array<{ call_id: string; output: string }> = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of (data.output ?? []) as any[]) {
        // Capture reasoning summaries
        if (item.type === "reasoning" && item.summary) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const summaryText = (item.summary as any[])
            .filter((s) => s.type === "summary_text")
            .map((s) => s.text as string)
            .join("\n");
          if (summaryText) {
            thinkingBlocks.push({ thinking: summaryText });
            onOutput?.(`[reasoning: ${summaryText.slice(0, 100)}...]\n`);
          }
        }

        // Capture text output
        if (item.type === "message" && item.content) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const block of item.content as any[]) {
            if (block.type === "output_text") {
              textOutput += block.text as string;
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

          const executor = toolExecutors.get(item.name as string);
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

          functionResults.push({ call_id: item.call_id as string, output: result });
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
