import { readFileSync, existsSync, appendFileSync } from "fs";
import { openaiLog } from "./openai-debug";
import { createRoutingToolChat } from "./openai-routing-tools";
import { ROUTING_TOOL_NAME } from "./constants";
import { AgentBase } from "./base";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import type { OpenAIRunOptions, OpenAIResult, OpenAITool } from "./openai-types";

/**
 * Runs the standard OpenAI Chat Completions agentic loop.
 * Handles multi-turn tool calling, MCP bridges, and routing.
 */
export async function runChatCompletions(options: OpenAIRunOptions): Promise<OpenAIResult> {
  const { provider, model, sessionFile, onOutput } = options;
  const maxTurns = options.maxTurns ?? 25;
  const startTime = Date.now();

  // Read messages from session file (managed by executor)
  const messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }> = [];

  if (sessionFile && existsSync(sessionFile)) {
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch { /* skip malformed lines */ }
    }
    const inputStr =
      options.input !== undefined
        ? (typeof options.input === "string" ? options.input : JSON.stringify(options.input, null, 2))
        : options.prompt ?? "";
    if (inputStr) {
      messages.push({ role: "user", content: inputStr });
    }
  } else {
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    const inputStr =
      options.input !== undefined
        ? (typeof options.input === "string" ? options.input : JSON.stringify(options.input, null, 2))
        : (options.prompt ?? "Start");
    messages.push({ role: "user", content: inputStr });
  }

  // Resolve tools via AgentBase
  const resolvedConfig: ResolvedAgentConfig = {
    allowedTools: options.allowedTools ?? [],
    mcpServers: options.mcpServers ?? [],
    mcpTools: options.mcpTools,
    knowledgeBases: options.knowledgeBases ?? [],
  };
  const agent = new AgentBase(resolvedConfig, options.workspace, options.runId);
  await agent.connectMcpServers();

  const activeTools: OpenAITool[] = [...(options.tools ?? []), ...agent.toChatTools()];
  const toolExecutors = agent.toolExecutors;

  // Add routing tool if conclave has ≥2 branches
  if (options.routeTargets && options.routeTargets.length >= 1) {
    activeTools.push(createRoutingToolChat(options.routeTargets));
  }

  // Register extra dynamic tools (e.g., ask_user for channel loops)
  if (options.extraTools) {
    for (const et of options.extraTools) {
      activeTools.push(et.tool);
      toolExecutors.set(et.tool.function.name, et.execute);
    }
  }

  // Debug: log resolved tools so operators can verify MCP connections
  openaiLog("RESOLVED TOOLS", {
    toolCount: activeTools.length,
    tools: activeTools.map((t) => t.function.name),
  });

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

      openaiLog(`CHAT REQUEST turn ${turn + 1}`, {
        provider: provider.name,
        model,
        messageCount: messages.length,
        toolCount: activeTools.length,
      });

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
        await agent.disconnect();
        return {
          success: false,
          output: "",
          error: `${provider.name} API error ${res.status}: ${errText}`,
          durationMs: Date.now() - startTime,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const choice = (data.choices as any[])?.[0];
      if (!choice) {
        await agent.disconnect();
        return {
          success: false,
          output: "",
          error: "No choices in response",
          durationMs: Date.now() - startTime,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assistantMsg = choice.message as any;
      const reasoning: string | null = assistantMsg.reasoning_content ?? assistantMsg.reasoning ?? null;
      openaiLog(`CHAT RESPONSE turn ${turn + 1}`, {
        content: assistantMsg.content?.slice(0, 500),
        reasoning: reasoning?.slice(0, 500),
        tool_calls: assistantMsg.tool_calls,
      });

      if (reasoning) {
        thinkingBlocks.push({ thinking: reasoning });
        onOutput?.(`[reasoning: ${reasoning.slice(0, 100)}...]\n`);
      }

      messages.push(assistantMsg);

      if (assistantMsg.tool_calls?.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onOutput?.(`[Tool calls: ${(assistantMsg.tool_calls as any[]).map((tc) => tc.function.name).join(", ")}]\n`);

        if (sessionFile) {
          appendFileSync(sessionFile, JSON.stringify(assistantMsg) + "\n");
        }

        let routeTo: string | undefined;
        let routeContent: string | undefined;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const toolCall of assistantMsg.tool_calls as any[]) {
          const fnName = toolCall.function.name as string;
          let fnArgs: Record<string, unknown>;
          try {
            fnArgs = typeof toolCall.function.arguments === "string"
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
          } catch {
            fnArgs = {};
          }

          // Check for routing
          if (fnName === ROUTING_TOOL_NAME && fnArgs.node_id) {
            routeTo = fnArgs.node_id as string;
            routeContent = (fnArgs.content as string) ?? "";
          }

          // Execute tool
          const executor = toolExecutors.get(fnName);
          let result: string;
          if (fnName === ROUTING_TOOL_NAME) {
            result = `Routing to: ${routeTo}`;
          } else if (executor) {
            onOutput?.(`[Executing ${fnName}...]\n`);
            result = await executor(fnArgs);
            onOutput?.(`[${fnName} result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}]\n`);
          } else {
            result = `Unknown tool: ${fnName}`;
          }

          const toolMsg = { role: "tool" as const, content: result, tool_call_id: toolCall.id };
          messages.push(toolMsg);
          if (sessionFile) {
            appendFileSync(sessionFile, JSON.stringify(toolMsg) + "\n");
          }
        }

        if (routeTo) {
          await agent.disconnect();
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

      const output: string = assistantMsg.content ?? "";
      onOutput?.(output);

      await agent.disconnect();
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
