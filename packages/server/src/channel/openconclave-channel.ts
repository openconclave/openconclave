#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, mkdirSync, readdirSync, unlinkSync, writeSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { VERSION } from "@openconclave/shared";

const OC_URL = process.env.OPENCONCLAVE_URL ?? "http://localhost:4000";
const OC_WS_URL = process.env.OPENCONCLAVE_WS_URL ?? "ws://localhost:4000";

const server = new Server(
  { name: "openconclave", version: VERSION },
  {
    capabilities: {
      tools: {},
      experimental: { "claude/channel": {} },
    },
    instructions: [
      'Events from OpenConclave arrive as <channel source="openconclave" event_type="..." ...>.',
      "",
      "Event types:",
      "- channel:output — a conclave produced output for you. Read and present to user.",
      "- prompt:question — a conclave is asking YOU a question and waiting for your response.",
      "",
      "Core tools:",
      "- oc_list_conclaves, oc_trigger_conclave, oc_get_run, oc_list_runs",
      "- oc_respond: respond to a pending prompt (REQUIRED when prompt:question events arrive)",
      "- oc_pending_prompts: list prompts waiting for response",
      "",
      "Conclave tools: Each enabled conclave with a toolName appears as its own tool.",
      "Call it directly to trigger the conclave — no need to use oc_trigger_conclave.",
      "",
      "IMPORTANT: When you receive a prompt:question event, respond immediately using oc_respond.",
    ].join("\n"),
  }
);

async function ocApi(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${OC_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

const tools: Map<string, ToolDef> = new Map();

function zodToSchema(params: Record<string, z.ZodType>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, val] of Object.entries(params)) {
    const isOptional = val instanceof z.ZodOptional;
    const inner = isOptional ? (val as z.ZodOptional<any>)._def.innerType : val;
    const prop: Record<string, unknown> = {};
    if (inner instanceof z.ZodString) prop.type = "string";
    else if (inner instanceof z.ZodNumber) prop.type = "number";
    else if (inner instanceof z.ZodBoolean) prop.type = "boolean";
    else if (inner instanceof z.ZodRecord) prop.type = "object";
    else prop.type = "string";
    if (inner._def.description) prop.description = inner._def.description;
    properties[key] = prop;
    if (!isOptional) required.push(key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function defineTool(name: string, description: string, params: Record<string, z.ZodType>, handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>) {
  tools.set(name, {
    name,
    description,
    schema: zodToSchema(params),
    handler,
  });
}

defineTool(
  "oc_list_conclaves",
  "List all conclaves in OpenConclave",
  {},
  async () => {
    const data = await ocApi("/conclaves") as { conclaves: unknown[] };
    const summary = (data.conclaves as Record<string, unknown>[]).map((w) => ({
      id: w.id,
      name: w.name,
      enabled: w.enabled,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

defineTool(
  "oc_trigger_conclave",
  "Trigger a conclave run. Always pass your current working directory as cwd so agents run in the correct project.",
  {
    conclave_id: z.string().describe("The conclave ID to trigger"),
    payload: z.record(z.unknown()).optional().describe("Optional payload data"),
    cwd: z.string().describe("Your current working directory — agents will run here"),
  },
  async ({ conclave_id, payload, cwd }) => {
    const enrichedPayload = { ...((payload as Record<string, unknown>) ?? {}), _callerCwd: cwd as string };
    const data = await ocApi(`/conclaves/${conclave_id}/run`, "POST", { payload: enrichedPayload });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

defineTool(
  "oc_get_run",
  "Get details of a specific conclave run including tasks and events",
  { run_id: z.string().describe("The run ID") },
  async ({ run_id }) => {
    const data = await ocApi(`/runs/${run_id}`) as { run: unknown; tasks: Record<string, unknown>[] };
    const tasks = data.tasks.map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      status: t.status,
      model: t.model,
      prompt: typeof t.prompt === "string" ? t.prompt.slice(0, 100) : t.prompt,
      output: typeof t.output === "string" ? t.output.slice(0, 300) : t.output,
      costUsd: t.costUsd,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ run: data.run, tasks }, null, 2) }] };
  }
);

defineTool(
  "oc_list_runs",
  "List recent conclave runs",
  { limit: z.number().optional().describe("Max results (default 10)") },
  async ({ limit }) => {
    const data = await ocApi(`/runs?limit=${limit ?? 10}`) as { runs: Record<string, unknown>[] };
    const summary = data.runs.map((r) => ({
      id: r.id,
      status: r.status,
      conclaveId: r.conclaveId,
      createdAt: r.createdAt,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

defineTool(
  "oc_respond",
  "Respond to a pending prompt question from a conclave. Use this to send your response so the conclave can continue.",
  {
    run_id: z.string().describe("The run ID"),
    node_id: z.string().describe("The prompt node ID"),
    response: z.string().describe("Your response to the question"),
  },
  async ({ run_id, node_id, response }) => {
    const data = await ocApi("/prompts/respond", "POST", { runId: run_id, nodeId: node_id, response });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

defineTool(
  "oc_pending_prompts",
  "List all pending prompt questions waiting for responses",
  {},
  async () => {
    const data = await ocApi("/prompts/pending");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

const MAX_OUTPUT_FILES = 200;
const registeredConclaveTools = new Set<string>();

async function syncConclaveTools() {
  try {
    const data = await ocApi("/conclaves") as { conclaves: Array<Record<string, unknown>> };
    const seen = new Set<string>();
    const oldRegistered = new Set(registeredConclaveTools);

    for (const wf of data.conclaves) {
      if (!wf.enabled) continue;
      const def = (wf.definition ?? {}) as Record<string, unknown>;
      const toolName = (def.toolName ?? wf.toolName) as string | undefined;
      if (!toolName) continue;

      seen.add(toolName);
      if (!registeredConclaveTools.has(toolName)) {
        if (tools.has(toolName)) {
          console.error(`[channel] skipping conclave tool "${toolName}": name conflicts with a built-in tool`);
          continue;
        }
        const description = ((def.description ?? wf.description ?? `Run conclave: ${wf.name}`) as string);
        const conclaveId = String(wf.id);

        defineTool(
          toolName,
          `${description}. Always pass your current working directory as cwd so agents run in the correct project.`,
          {
            input: z.string().optional().describe("Input data to pass to the conclave trigger"),
            cwd: z.string().describe("Your current working directory — agents will run here"),
          },
          async ({ input, cwd }) => {
            const payload = { ...((input as string) ? { input } : {}), _callerCwd: cwd as string };
            const result = await ocApi(`/conclaves/${conclaveId}/run`, "POST", { payload });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }
        );
        registeredConclaveTools.add(toolName);
      }
    }

    for (const t of registeredConclaveTools) {
      if (!seen.has(t)) {
        registeredConclaveTools.delete(t);
        tools.delete(t);
      }
    }

    if (seen.size !== oldRegistered.size ||
        [...seen].some((t) => !oldRegistered.has(t)) ||
        [...oldRegistered].some((t) => !seen.has(t))) {
      try {
        await server.notification({ method: "notifications/tools/list_changed" });
      } catch { /* client may not support */ }
    }
  } catch (err) {
    console.error("[channel] syncConclaveTools error:", err);
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [...tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.schema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = tools.get(name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    return await tool.handler(args ?? {});
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message ?? err}` }], isError: true };
  }
});

await syncConclaveTools();
console.error(`[channel] synced ${registeredConclaveTools.size} conclave tools`);

// Workaround: Bun compiled binaries on Windows buffer piped stdout.
// Use writeSync(fd=1) to bypass Node.js stream layer entirely.
process.stdout.write = function (chunk: any, encoding?: any, callback?: any) {
  const data = typeof chunk === "string" ? chunk : chunk.toString();
  try {
    writeSync(1, data);
  } catch (err: any) {
    if (typeof encoding === "function") encoding(err);
    else if (typeof callback === "function") callback(err);
    return false;
  }
  if (typeof encoding === "function") encoding();
  else if (typeof callback === "function") callback();
  return true;
} as any;

const transport = new StdioServerTransport();
await server.connect(transport);

function connectWebSocket() {
  try {
    const ws = new WebSocket(OC_WS_URL);

    ws.onopen = () => {
      console.error("[channel] WebSocket connected to", OC_WS_URL);
      ws.send(JSON.stringify({ type: "subscribe", topics: ["dashboard"] }));
    };

    ws.onmessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data.toString());
        const eventType = data.type as string;

        if (eventType === "channel:output" || eventType === "prompt:question") {
          const meta: Record<string, string> = {
            event_type: eventType,
            run_id: data.runId ?? "",
          };
          if (data.nodeId) meta.node_id = data.nodeId;
          if (data.data?.taskId) meta.task_id = data.data.taskId;
          if (data.data?.status) meta.status = data.data.status;
          if (data.data?.success !== undefined) meta.success = String(data.data.success);
          if (data.data?.durationMs !== undefined) meta.duration_ms = String(data.data.durationMs);
          if (data.data?.conclaveName) meta.conclave_name = data.data.conclaveName;
          if (data.data?.nodeLabel) meta.node_label = data.data.nodeLabel;
          if (data.data?.senderNode) meta.sender_node = data.data.senderNode;
          if (data.data?.senderType) meta.sender_type = data.data.senderType;

          const fullContent =
            typeof data.data === "string"
              ? data.data
              : JSON.stringify(data.data ?? {}, null, 2);

          const outputDir = join(process.cwd(), ".openconclave", "outputs");
          mkdirSync(outputDir, { recursive: true });
          const existingFiles = readdirSync(outputDir);
          if (existingFiles.length >= MAX_OUTPUT_FILES) {
            existingFiles.sort();
            for (const f of existingFiles.slice(0, existingFiles.length - MAX_OUTPUT_FILES + 1)) {
              try { unlinkSync(join(outputDir, f)); } catch {}
            }
          }
          const fileName = `output-${data.runId ?? "unknown"}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.md`;
          const filePath = join(outputDir, fileName);
          writeFileSync(filePath, fullContent);
          meta.output_file = filePath;

          const MAX_INLINE = 2000;
          const content = fullContent.length > MAX_INLINE
            ? fullContent.slice(0, MAX_INLINE) + `\n\n--- truncated (${fullContent.length} chars) ---\nFull output: ${filePath}`
            : fullContent;

          await server.notification({
            method: "notifications/claude/channel",
            params: { content, meta },
          });
        }

        if (eventType === "channel:improve-prompt") {
          const d = data.data ?? {};
          const content = [
            "A user wants you to improve an agent's system prompt in OpenConclave.",
            "",
            `Conclave ID: ${d.conclaveId}`,
            `Node ID: ${d.nodeId}`,
            `Node Label: ${d.nodeLabel}`,
            "",
            "Current prompt:",
            d.currentPrompt || "(empty)",
            "",
            "Please write an improved version of this system prompt — make it clearer, more effective, and well-structured.",
            "Then call `update_node` to save it:",
            `  update_node(conclaveId: "${d.conclaveId}", nodeId: "${d.nodeId}", config: { systemPrompt: "your improved prompt" })`,
          ].join("\n");

          // Route improve events through channel:output so Claude Code delivers them
          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: { event_type: "channel:output", node_label: "Improve Prompt" },
            },
          });
        }

        if (eventType === "channel:improve-description") {
          const d = data.data ?? {};
          const content = [
            "A user wants you to improve the conclave-level Instructions for Claude in OpenConclave.",
            "",
            `Conclave ID: ${d.conclaveId}`,
            "",
            "Current instructions:",
            d.currentDescription || "(empty)",
            "",
            "Please write an improved version — make it clearer, more effective, and well-structured.",
            "Then call `update_conclave` to save it:",
            `  update_conclave(conclaveId: "${d.conclaveId}", description: "your improved instructions")`,
          ].join("\n");

          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: { event_type: "channel:output", node_label: "Improve Description" },
            },
          });
        }

        if (eventType === "channel:improve-code") {
          const d = data.data ?? {};
          const content = [
            "A user wants you to write or improve code for a Code node in OpenConclave.",
            "",
            `Conclave ID: ${d.conclaveId}`,
            `Node ID: ${d.nodeId}`,
            `Node Label: ${d.nodeLabel}`,
            `Runtime: ${d.runtime}`,
            "",
            "Current code:",
            d.currentCode || "(empty — user may have typed a description of what they want)",
            "",
            "If the current code looks like a natural-language description, write the code from scratch.",
            "If it's already code, improve it — make it more robust, fix bugs, and clean it up.",
            `The runtime is ${d.runtime}. Input from the previous node is passed via stdin and $INPUT env var. Output must go to stdout as JSON.`,
            "",
            "Then call `update_node` to save it:",
            `  update_node(conclaveId: "${d.conclaveId}", nodeId: "${d.nodeId}", config: { code: "your code here" })`,
          ].join("\n");

          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: { event_type: "channel:output", node_label: "Improve Code" },
            },
          });
        }

        if (
          eventType === "conclave:updated" ||
          eventType === "conclave:created" ||
          eventType === "conclave:deleted"
        ) {
          await syncConclaveTools();
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      console.error("[channel] WebSocket closed, reconnecting in 5s...");
      setTimeout(connectWebSocket, 5000);
    };
    ws.onerror = (e: Event) => {
      console.error("[channel] WebSocket error:", e);
    };
  } catch {
    setTimeout(connectWebSocket, 5000);
  }
}

connectWebSocket();
