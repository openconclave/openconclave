import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client";
import { agentTasks, settings } from "../db/schema";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import { VERSION } from "@openconclave/shared";
import type { RunEvent } from "../engine/types";
import { logger } from "../lib/logger";

// ── Types ───────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface InvokeWithToolsOptions {
  engine: string;
  config: ResolvedAgentConfig;
  prompt: string;
  tools: ToolDef[];
  runId: number;
  nodeId: string;
  emit: (event: RunEvent) => void;
  abortController?: AbortController;
}

interface ToolCallResult {
  output: string;
  tool_call?: {
    name: string;
    input: Record<string, unknown>;
  };
}

// ── Main dispatcher ─────────────────────────────────────────

export async function invokeWithTools(options: InvokeWithToolsOptions): Promise<ToolCallResult> {
  const { engine } = options;

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

  const taskId = taskResult[0]!.id;
  let result: ToolCallResult;
  let taskCompleted = false;

  try {
    options.emit({ type: "agent:started", runId: options.runId, nodeId: options.nodeId, data: { taskId, engine } });
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
        throw new Error(`Unknown engine: ${engine}`);
    }

    await db.update(agentTasks).set({
      status: "success",
      output: result.output,
      completedAt: new Date().toISOString(),
    }).where(eq(agentTasks.id, taskId));
    taskCompleted = true;
    options.emit({ type: "agent:completed", runId: options.runId, nodeId: options.nodeId, data: { taskId, success: true } });
  } catch (err: unknown) {
    if (!taskCompleted) {
      // Protect the failure-path DB write so a secondary error here does not
      // mask the original engine failure or swallow agent:completed.
      const message = err instanceof Error ? err.message : String(err);
      try {
        await db.update(agentTasks).set({ status: "failure", error: message, completedAt: new Date().toISOString() }).where(eq(agentTasks.id, taskId));
      } catch (updateErr: unknown) {
        logger.error("Failed to mark agent task as failure", { taskId, originalError: message, updateError: updateErr instanceof Error ? updateErr.message : String(updateErr) });
      }
      try {
        options.emit({ type: "agent:completed", runId: options.runId, nodeId: options.nodeId, data: { taskId, success: false } });
      } catch (emitErr: unknown) {
        logger.error("Failed to emit agent:completed", { taskId, emitError: emitErr instanceof Error ? emitErr.message : String(emitErr) });
      }
    }
    throw err;
  }

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
    } else if (schema.type === "object") {
      mockInput[key] = {};
    } else if (schema.type === "array") {
      mockInput[key] = [];
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
  // Defer validation to first use so a misconfigured OLLAMA_URL does not
  // crash the server for callers using other engines.
  if (!isAcceptableOllamaUrl(OLLAMA_URL)) {
    throw new Error(`OLLAMA_URL "${OLLAMA_URL}" is not an acceptable URL (RFC1918, link-local, and non-http(s) blocked)`);
  }
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
    signal: options.abortController?.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as { message: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> | string } }> } };
  const msg = data.message;

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    const tc = msg.tool_calls[0]!;
    let args: Record<string, unknown>;
    if (typeof tc.function.arguments === "string") {
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        throw new Error(
          `Ollama returned unparseable tool arguments for "${tc.function.name}": ${tc.function.arguments.slice(0, 200)}`
        );
      }
    } else {
      args = tc.function.arguments as Record<string, unknown>;
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new Error(
        `Ollama returned unparseable tool arguments for "${tc.function.name}": expected object, got ${args === null ? "null" : Array.isArray(args) ? "array" : typeof args}`,
      );
    }
    return {
      output: JSON.stringify({ tool_name: tc.function.name, tool_input: args }),
      tool_call: { name: tc.function.name, input: args },
    };
  }

  return { output: msg.content ?? "" };
}

// ── OpenAI engine ───────────────────────────────────────────

async function invokeOpenAI(options: InvokeWithToolsOptions): Promise<ToolCallResult> {
  const providerId = options.config.providerId;
  if (!providerId) throw new Error("No OpenAI provider configured");

  const providerRow = await db.select().from(settings).where(eq(settings.key, `provider:${providerId}`)).get();
  if (!providerRow) throw new Error(`Provider "${providerId}" not found`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(providerRow.value);
  } catch {
    throw new Error(`Provider "${providerId}" has malformed JSON in settings`);
  }
  const provider = providerSchema.parse(parsed);

  // Resolve the hostname now and re-check the resolved IPs against the
  // public-host blocklist. Without this, a public-looking name like
  // exfil.attacker.example can resolve to 169.254.169.254 (cloud metadata)
  // at fetch time, sending the Authorization header to a private address.
  await assertResolvedHostIsPublic(new URL(provider.baseUrl).hostname);

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
    signal: options.abortController?.signal,
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
  if (!choice) {
    throw new Error("OpenAI returned no choices");
  }
  if (choice.tool_calls && choice.tool_calls.length > 0) {
    const tc = choice.tool_calls[0]!;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      throw new Error(
        `OpenAI returned unparseable tool arguments for "${tc.function.name}": ${tc.function.arguments.slice(0, 200)}`
      );
    }
    return {
      output: JSON.stringify({ tool_name: tc.function.name, tool_input: args }),
      tool_call: { name: tc.function.name, input: args },
    };
  }

  return { output: choice.content ?? "" };
}

// ── Provider URL validation (SSRF guard) ────────────────────

// Allow loopback for local Ollama installs; block everything else isPublicHttpUrl blocks.
export function isAcceptableOllamaUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
  return isPublicHttpUrl(url);
}

// Reject internal / loopback / link-local / RFC1918 hosts so a DB-stored
// provider.baseUrl cannot coerce the server into proxying requests to cloud
// metadata services (169.254.169.254) or internal infrastructure.
export function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0") return false;
  const bareHost = host.startsWith("[") ? host.slice(1, -1) : host;
  if (bareHost === "::1") return false;
  if (bareHost.startsWith("fe80:") || bareHost.startsWith("fc") || bareHost.startsWith("fd")) return false;
  if (bareHost.includes("::ffff:")) return false;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0) return false;                // 0.0.0.0/8 (this network)
    if (a === 127) return false;              // loopback
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 10) return false;               // RFC1918
    if (a === 192 && b === 168) return false; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return false; // RFC6598 CGNAT
  }
  return true;
}

async function assertResolvedHostIsPublic(hostname: string): Promise<void> {
  const dns = await import("node:dns/promises");
  const addresses = await dns.lookup(hostname, { all: true });
  for (const { address } of addresses) {
    const probe = address.includes(":") ? `https://[${address}]` : `https://${address}`;
    if (!isPublicHttpUrl(probe)) {
      throw new Error(
        `Provider hostname "${hostname}" resolves to a non-public address (${address})`,
      );
    }
  }
}

const providerSchema = z.object({
  // Require https so a misconfigured provider does not transmit the API key
  // over cleartext. Public-IP guard still applies via isPublicHttpUrl.
  baseUrl: z.string().refine((u) => u.startsWith("https://") && isPublicHttpUrl(u), {
    message: "baseUrl must be an https URL on a public host — internal / loopback / http URLs are blocked",
  }),
  apiKey: z.string().min(1),
});

// ── JSON schema → Zod shape converter ───────────────────────

const JSON_SCHEMA_MAX_DEPTH = 10;

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
    let zodProp = jsonSchemaToZod(propSchema, 1);
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
  const { getCliPath, isAllowedModel } = await import("./runtime");
  const { buildSubprocessEnv } = await import("./subprocess-env");

  const model = options.config.model && isAllowedModel(options.config.model) ? options.config.model : undefined;

  const systemPrompt = options.config.systemPrompt ?? "";

  // First-wins: the caller expects the initial tool decision to be the routing
  // signal. With maxTurns > 1, a later handler overwriting state silently loses
  // the first choice.
  const toolState: { toolName?: string; toolInput?: Record<string, unknown> } = {};

  // Private controller so we can abort the SDK after the first tool call without
  // canceling unrelated work the caller may still be doing on options.abortController.
  const innerController = new AbortController();
  const externalSignal = options.abortController?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) innerController.abort();
    else externalSignal.addEventListener("abort", () => innerController.abort(), { once: true });
  }

  const sdkTools = options.tools.map((t) =>
    tool(
      t.name,
      t.description,
      toolShape(t.input_schema),
      async (args: Record<string, unknown>) => {
        if (!toolState.toolName) {
          toolState.toolName = t.name;
          toolState.toolInput = args;
          // Abort to short-circuit the rest of the SDK turn budget; without this
          // the loop can exhaust maxTurns and throw "Reached maximum number of turns".
          innerController.abort();
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
      pathToClaudeCodeExecutable: getCliPath(),
      env: buildSubprocessEnv(),
      model,
      systemPrompt,
      // Safety ceiling, not the expected exit path: the tool callback aborts on
      // first call so a healthy run typically uses 1–2 turns.
      maxTurns: 10,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: [],
      mcpServers,
      strictMcpConfig: true,
      abortController: innerController,
    },
  });

  // Drain the SDK generator. Tool dispatch happens via the MCP callback above;
  // messages are not inspected at this level. Swallow AbortError when it was
  // our own abort fired after recording a tool, otherwise rethrow.
  try {
    for await (const _ of agentQuery) {
      void _;
    }
  } catch (err: unknown) {
    if (!(innerController.signal.aborted && toolState.toolName)) {
      throw err;
    }
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
