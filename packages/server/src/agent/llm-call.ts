/**
 * llm-call.ts — Single-turn LLM call with dynamic tool definitions.
 *
 * Used by the invoke endpoint when `tools` are provided.
 * Each engine gets a lightweight path: prompt + tools in → tool call result out.
 *
 * - Claude: uses in-process SDK MCP server via Agent SDK query()
 * - Ollama: /api/chat with tools
 * - OpenAI: Chat Completions with function calling
 * - Debug: returns first enum value from first tool
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client";
import { agentTasks, settings } from "../db/schema";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import { VERSION } from "@openconclave/shared";
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
  abortController?: AbortController;
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
  if (!tool) {
    return { output: JSON.stringify({ debug: "no tools supplied" }) };
  }
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

  const parsed = JSON.parse(providerRow.value) as unknown;
  const provider = providerSchema.parse(parsed);
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

// ── Provider URL validation (SSRF guard) ────────────────────

// Reject internal / loopback / link-local / RFC1918 hosts so a DB-stored
// provider.baseUrl cannot coerce the server into proxying requests to cloud
// metadata services (169.254.169.254) or internal infrastructure.
function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0") return false;
  if (host === "::1" || host === "[::1]") return false;
  if (host.startsWith("[fe80:") || host.startsWith("[fc") || host.startsWith("[fd")) return false;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return false;              // loopback
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 10) return false;               // RFC1918
    if (a === 192 && b === 168) return false; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  }
  return true;
}

const providerSchema = z.object({
  baseUrl: z.string().refine(isPublicHttpUrl, {
    message: "baseUrl must be a public http(s) URL — internal / loopback / file URLs are blocked",
  }),
  apiKey: z.string().min(1),
});

// ── JSON schema → Zod shape converter ───────────────────────

const JSON_SCHEMA_MAX_DEPTH = 20;

function jsonSchemaToZod(schema: Record<string, unknown>, depth = 0): z.ZodType {
  // Depth limit prevents caller-supplied nested schemas from exhausting the
  // JS stack. A stack overflow under async_hooks (OTel, APM) bypasses
  // try/catch and exits the Node process — turning a request bug into a DoS.
  if (depth > JSON_SCHEMA_MAX_DEPTH) {
    throw new Error(`jsonSchemaToZod: schema nesting exceeds max depth ${JSON_SCHEMA_MAX_DEPTH}`);
  }

  const type = schema.type as string;
  const enumValues = schema.enum as unknown[] | undefined;

  if (enumValues && enumValues.length > 0) {
    const stringValues = enumValues.filter((v): v is string => typeof v === "string");
    if (stringValues.length === enumValues.length) {
      return z.enum(stringValues as [string, ...string[]]);
    }
    // Mixed or non-string enum: z.enum doesn't accept non-strings (throws at
    // runtime). Fall back to a union of literals.
    const literals = enumValues.map((v) => z.literal(v as string | number | boolean));
    if (literals.length === 1) return literals[0]!;
    return z.union(literals as unknown as [z.ZodLiteral<string>, z.ZodLiteral<string>, ...z.ZodLiteral<string>[]]);
  }

  switch (type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required ?? []) as string[];
      const shape: Record<string, z.ZodType> = {};
      for (const [key, propSchema] of Object.entries(props)) {
        const zodProp = jsonSchemaToZod(propSchema, depth + 1);
        shape[key] = required.includes(key) ? zodProp : zodProp.optional();
      }
      return z.object(shape);
    }
    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      return z.array(items ? jsonSchemaToZod(items, depth + 1) : z.unknown());
    }
    default:
      return z.unknown();
  }
}

function toolShape(inputSchema: Record<string, unknown>): Record<string, z.ZodType> {
  const props = (inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (inputSchema.required ?? []) as string[];
  const shape: Record<string, z.ZodType> = {};
  for (const [key, propSchema] of Object.entries(props)) {
    let zodProp = jsonSchemaToZod(propSchema);
    const desc = propSchema.description as string | undefined;
    if (desc) {
      zodProp = zodProp.describe(desc);
    }
    shape[key] = required.includes(key) ? zodProp : zodProp.optional();
  }
  return shape;
}

// ── Claude engine (via Agent SDK + in-process SDK MCP) ──────

const DYNAMIC_TOOLS_MCP_NAME = "openconclave-dynamic-tools";

async function invokeClaude(options: InvokeWithToolsOptions): Promise<ToolCallResult> {
  const { query, createSdkMcpServer, tool } = await import("@anthropic-ai/claude-agent-sdk");
  const { cliPath, buildSubprocessEnv } = await import("./runtime");

  const modelMap: Record<string, string> = { sonnet: "sonnet", opus: "opus", haiku: "haiku" };
  const model = options.config.model && modelMap[options.config.model]
    ? modelMap[options.config.model]
    : undefined;

  const systemPrompt = options.config.systemPrompt ?? "";

  // First-wins: the caller expects the initial tool decision to be the routing
  // signal. With maxTurns > 1, a later handler overwriting state silently loses
  // the first choice.
  const toolState: { toolName?: string; toolInput?: Record<string, unknown> } = {};

  const sdkTools = options.tools.map((t) =>
    tool(
      t.name,
      t.description,
      toolShape(t.input_schema),
      async (args: Record<string, unknown>) => {
        if (!toolState.toolName) {
          toolState.toolName = t.name;
          toolState.toolInput = args;
        }
        return {
          content: [{ type: "text", text: `Action recorded: ${t.name}` }],
        };
      },
    ),
  );

  // mcpServers key must match the server's `name` — the SDK routes tool
  // dispatch by key, and a mismatch silently breaks routing.
  const mcpServers = {
    [DYNAMIC_TOOLS_MCP_NAME]: createSdkMcpServer({
      name: DYNAMIC_TOOLS_MCP_NAME,
      version: VERSION,
      tools: sdkTools,
    }),
  };

  const agentQuery = query({
    prompt: options.prompt,
    options: {
      pathToClaudeCodeExecutable: cliPath,
      env: buildSubprocessEnv(),
      model,
      systemPrompt,
      maxTurns: 3,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: [],
      mcpServers,
      strictMcpConfig: true,
      abortController: options.abortController,
    },
  });

  for await (const _message of agentQuery) {
    // Consume the generator — we just need it to complete
    void _message;
  }

  if (toolState.toolName) {
    const payload = { tool_name: toolState.toolName, tool_input: toolState.toolInput ?? {} };
    return {
      output: JSON.stringify(payload),
      tool_call: { name: toolState.toolName, input: toolState.toolInput ?? {} },
    };
  }

  return { output: "(agent did not call any tool)" };
}
