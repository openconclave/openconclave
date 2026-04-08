/**
 * llm-call.ts — Single-turn LLM call with dynamic tool definitions.
 *
 * Used by the invoke endpoint when `tools` are provided.
 * Each engine gets a lightweight path: prompt + tools in → tool call result out.
 *
 * - Claude: spawns dynamic-tools-mcp-server.ts via Agent SDK query()
 * - Ollama: /api/chat with tools
 * - OpenAI: Chat Completions with function calling
 * - Debug: returns first enum value from first tool
 */

import { resolve, join } from "path";
import { mkdirSync, existsSync, readFileSync, unlinkSync } from "fs";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { agentTasks, settings } from "../db/schema";
import { TMP_DIR } from "../lib/workspace";
import { logger } from "../lib/logger";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import type { RunEvent } from "../engine/types";

// ── Types ───────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface InvokeWithToolsOptions {
  engine: string;
  config: ResolvedAgentConfig;
  prompt: string;
  tools: ToolDef[];
  runId: number;
  nodeId: string;
  emit: (event: RunEvent) => void;
}

export interface ToolCallResult {
  output: string;
  tool_call?: {
    name: string;
    input: Record<string, unknown>;
  };
}

// ── Main dispatcher ─────────────────────────────────────────

export async function invokeWithTools(options: InvokeWithToolsOptions): Promise<ToolCallResult> {
  const { engine } = options;

  // Log agent task
  const now = new Date().toISOString();
  const modelName = engine === "debug" ? "debug"
    : engine === "ollama" ? (options.config.ollamaModel ?? "unknown")
    : engine === "openai" ? (options.config.openaiModel ?? "unknown")
    : (options.config.model ?? "sonnet");

  const taskResult = await db.insert(agentTasks).values({
    runId: options.runId,
    nodeId: options.nodeId,
    status: "running",
    prompt: options.prompt,
    systemPrompt: options.config.systemPrompt,
    model: `${engine}/${modelName}`,
    input: options.tools.length > 0 ? { tools: options.tools.map((t) => t.name) } : null,
    startedAt: now,
    createdAt: now,
  }).returning({ id: agentTasks.id });

  const taskId = taskResult[0].id;
  options.emit({ type: "agent:started", runId: options.runId, nodeId: options.nodeId, data: { taskId, engine } });

  let result: ToolCallResult;

  try {
    switch (engine) {
      case "debug":
        result = invokeDebug(options);
        break;
      case "ollama":
        result = await invokeOllama(options);
        break;
      case "openai":
        result = await invokeOpenAI(options);
        break;
      case "claude":
        result = await invokeClaude(options);
        break;
      default:
        result = await invokeClaude(options);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(agentTasks).set({ status: "failure", error: message, completedAt: new Date().toISOString() }).where(eq(agentTasks.id, taskId));
    options.emit({ type: "agent:completed", runId: options.runId, nodeId: options.nodeId, data: { taskId, success: false } });
    throw err;
  }

  await db.update(agentTasks).set({
    status: "success",
    output: result.output,
    completedAt: new Date().toISOString(),
  }).where(eq(agentTasks.id, taskId));

  options.emit({ type: "agent:completed", runId: options.runId, nodeId: options.nodeId, data: { taskId, success: true } });

  return result;
}

// ── Debug engine ────────────────────────────────────────────

function invokeDebug(options: InvokeWithToolsOptions): ToolCallResult {
  const tool = options.tools[0];
  const mockInput: Record<string, unknown> = {};

  const props = (tool.input_schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const [key, schema] of Object.entries(props)) {
    if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
      mockInput[key] = schema.enum[0];
    } else if (schema.type === "string") {
      mockInput[key] = `(debug ${key})`;
    } else if (schema.type === "number" || schema.type === "integer") {
      mockInput[key] = 0;
    } else if (schema.type === "boolean") {
      mockInput[key] = true;
    }
  }

  return {
    output: JSON.stringify({ tool_name: tool.name, tool_input: mockInput }),
    tool_call: { name: tool.name, input: mockInput },
  };
}

// ── Ollama engine ───────────────────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

async function invokeOllama(options: InvokeWithToolsOptions): Promise<ToolCallResult> {
  const model = options.config.ollamaModel ?? "qwen3:8b";

  const ollamaTools = options.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const messages: Array<{ role: string; content: string }> = [];
  if (options.config.systemPrompt) {
    messages.push({ role: "system", content: options.config.systemPrompt });
  }
  messages.push({ role: "user", content: options.prompt });

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools: ollamaTools,
      stream: false,
      options: { num_ctx: 32768 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as { message: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> } };
  const msg = data.message;

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    const tc = msg.tool_calls[0];
    return {
      output: JSON.stringify({ tool_name: tc.function.name, tool_input: tc.function.arguments }),
      tool_call: { name: tc.function.name, input: tc.function.arguments },
    };
  }

  // Fallback: no tool call, return text
  return { output: msg.content ?? "" };
}

// ── OpenAI engine ───────────────────────────────────────────

async function invokeOpenAI(options: InvokeWithToolsOptions): Promise<ToolCallResult> {
  const providerId = options.config.providerId;
  if (!providerId) throw new Error("No OpenAI provider configured");

  const providerRow = await db.select().from(settings).where(eq(settings.key, `provider:${providerId}`)).get();
  if (!providerRow) throw new Error(`Provider "${providerId}" not found`);

  const provider = JSON.parse(providerRow.value) as { baseUrl: string; apiKey: string };
  const model = options.config.openaiModel ?? "gpt-4o";

  const openaiTools = options.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const messages: Array<{ role: string; content: string }> = [];
  if (options.config.systemPrompt) {
    messages.push({ role: "system", content: options.config.systemPrompt });
  }
  messages.push({ role: "user", content: options.prompt });

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: openaiTools,
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    choices: Array<{
      message: {
        content?: string;
        tool_calls?: Array<{ function: { name: string; arguments: string } }>;
      };
    }>;
  };

  const choice = data.choices[0]?.message;
  if (choice?.tool_calls && choice.tool_calls.length > 0) {
    const tc = choice.tool_calls[0];
    const args = JSON.parse(tc.function.arguments);
    return {
      output: JSON.stringify({ tool_name: tc.function.name, tool_input: args }),
      tool_call: { name: tc.function.name, input: args },
    };
  }

  return { output: choice?.content ?? "" };
}

// ── Claude engine (via Agent SDK + dynamic MCP) ─────────────

async function invokeClaude(options: InvokeWithToolsOptions): Promise<ToolCallResult> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const modelMap: Record<string, string> = { sonnet: "sonnet", opus: "opus", haiku: "haiku" };
  const model = options.config.model && modelMap[options.config.model]
    ? modelMap[options.config.model]
    : undefined;

  // Set up dynamic tools MCP server
  mkdirSync(TMP_DIR, { recursive: true });
  const stateFile = join(TMP_DIR, `tools-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const mcpPath = resolve(import.meta.dir, "dynamic-tools-mcp-server.ts");

  const toolNames = options.tools.map((t) => t.name).join(", ");

  // Append instruction to call one of the tools
  const systemPrompt = [
    options.config.systemPrompt ?? "",
    `\nYou MUST call one of these tools to complete your action: ${toolNames}`,
    "Call the tool and then stop. Do not continue after calling the tool.",
  ].join("\n");

  const mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {
    "game-tools": {
      command: "bun",
      args: ["run", mcpPath],
      env: {
        OC_STATE_FILE: stateFile,
        OC_DYNAMIC_TOOLS: JSON.stringify(options.tools),
      },
    },
  };

  try {
    const agentQuery = query({
      prompt: options.prompt,
      options: {
        model,
        systemPrompt,
        maxTurns: 3,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: [],
        mcpServers,
      },
    });

    for await (const message of agentQuery) {
      // Consume the generator — we just need it to complete
    }

    // Read tool call from state file
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as { tool_name: string; tool_input: Record<string, unknown> };
      try { unlinkSync(stateFile); } catch { /* ignore */ }
      return {
        output: JSON.stringify(state),
        tool_call: { name: state.tool_name, input: state.tool_input },
      };
    }

    // No tool call — agent returned text without calling a tool
    try { unlinkSync(stateFile); } catch { /* ignore */ }
    return { output: "(agent did not call any tool)" };
  } catch (err: unknown) {
    try { unlinkSync(stateFile); } catch { /* ignore */ }
    throw err;
  }
}
