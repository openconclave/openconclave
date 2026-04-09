#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { z } from "zod";

const OC_URL = process.env.OPENCONCLAVE_URL ?? "http://localhost:4000";
const OC_WS_URL = process.env.OPENCONCLAVE_WS_URL ?? "ws://localhost:4000";

// ── MCP Server ──────────────────────────────────────────────

const mcp = new McpServer(
  { name: "openconclave", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
    },
    instructions: [
      'Events from OpenConclave arrive as <channel source="openconclave" event_type="..." ...>.',
      "",
      "Event types:",
      "- channel:output — a workflow produced output for you. Read and present to user.",
      "- prompt:question — a workflow is asking YOU a question and waiting for your response.",
      "",
      "Core tools:",
      "- oc_list_workflows, oc_trigger_workflow, oc_get_run, oc_list_runs",
      "- oc_respond: respond to a pending prompt (REQUIRED when prompt:question events arrive)",
      "- oc_pending_prompts: list prompts waiting for response",
      "",
      "Workflow tools: Each enabled workflow with a toolName appears as its own tool.",
      "Call it directly to trigger the workflow — no need to use oc_trigger_workflow.",
      "",
      "IMPORTANT: When you receive a prompt:question event, respond immediately using oc_respond.",
    ].join("\n"),
  }
);

// ── API helper ──────────────────────────────────────────────

async function ocApi(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${OC_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ── Core tools ──────────────────────────────────────────────

mcp.tool(
  "oc_list_workflows",
  "List all workflows in OpenConclave",
  {},
  async () => {
    const data = await ocApi("/workflows") as { workflows: unknown[] };
    const summary = (data.workflows as Record<string, unknown>[]).map((w) => ({
      id: w.id,
      name: w.name,
      enabled: w.enabled,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

mcp.tool(
  "oc_trigger_workflow",
  "Trigger a workflow run. Always pass your current working directory as cwd so agents run in the correct project.",
  {
    workflow_id: z.string().describe("The workflow ID to trigger"),
    payload: z.record(z.unknown()).optional().describe("Optional payload data"),
    cwd: z.string().describe("Your current working directory — agents will run here"),
  },
  async ({ workflow_id, payload, cwd }) => {
    const enrichedPayload = { ...(payload ?? {}), ...(cwd ? { _callerCwd: cwd } : {}) };
    const data = await ocApi(`/workflows/${workflow_id}/run`, "POST", { payload: enrichedPayload });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

mcp.tool(
  "oc_get_run",
  "Get details of a specific workflow run including tasks and events",
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

mcp.tool(
  "oc_list_runs",
  "List recent workflow runs",
  { limit: z.number().optional().describe("Max results (default 10)") },
  async ({ limit }) => {
    const data = await ocApi(`/runs?limit=${limit ?? 10}`) as { runs: Record<string, unknown>[] };
    const summary = data.runs.map((r) => ({
      id: r.id,
      status: r.status,
      workflowId: r.workflowId,
      createdAt: r.createdAt,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

mcp.tool(
  "oc_respond",
  "Respond to a pending prompt question from a workflow. Use this to send your response so the workflow can continue.",
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

mcp.tool(
  "oc_pending_prompts",
  "List all pending prompt questions waiting for responses",
  {},
  async () => {
    const data = await ocApi("/prompts/pending");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Dynamic workflow tools ──────────────────────────────────

const registeredWorkflowTools = new Set<string>();

async function syncWorkflowTools() {
  try {
    const data = await ocApi("/workflows") as { workflows: Array<Record<string, unknown>> };
    const seen = new Set<string>();

    // Snapshot the current registered set BEFORE any mutations
    const oldRegistered = new Set(registeredWorkflowTools);

    for (const wf of data.workflows) {
      if (!wf.enabled) continue;
      const def = (wf.definition ?? {}) as Record<string, unknown>;
      const toolName = (def.toolName ?? wf.toolName) as string | undefined;
      if (!toolName) continue;

      seen.add(toolName);
      if (!registeredWorkflowTools.has(toolName)) {
        const description = ((def.description ?? wf.description ?? `Run workflow: ${wf.name}`) as string);
        const workflowId = String(wf.id);

        mcp.tool(
          toolName,
          `${description}. Always pass your current working directory as cwd so agents run in the correct project.`,
          {
            input: z.string().optional().describe("Input data to pass to the workflow trigger"),
            cwd: z.string().describe("Your current working directory — agents will run here"),
          },
          async ({ input, cwd }) => {
            const payload = { ...(input ? { input } : {}), ...(cwd ? { _callerCwd: cwd } : {}) };
            const result = await ocApi(`/workflows/${workflowId}/run`, "POST", { payload });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }
        );
        registeredWorkflowTools.add(toolName);
      }
    }

    // Remove stale entries for disabled/deleted workflows
    for (const t of registeredWorkflowTools) {
      if (!seen.has(t)) registeredWorkflowTools.delete(t);
    }

    // Notify client if tools changed — compare against PRE-MUTATION snapshot
    if (seen.size !== oldRegistered.size ||
        [...seen].some((t) => !oldRegistered.has(t)) ||
        [...oldRegistered].some((t) => !seen.has(t))) {
      try {
        await mcp.server.sendNotification({ method: "notifications/tools/list_changed" });
      } catch { /* client may not support */ }
    }
  } catch (err) {
    console.error("[channel] syncWorkflowTools error:", err);
  }
}

// Sync before connecting so tools are available on first ListTools call
await syncWorkflowTools();
console.error(`[channel] synced ${registeredWorkflowTools.size} workflow tools`);

// ── Connect ─────────────────────────────────────────────────

const transport = new StdioServerTransport();
await mcp.connect(transport);

// ── WebSocket: subscribe to OpenConclave events ─────────────

function connectWebSocket() {
  try {
    const ws = new WebSocket(OC_WS_URL);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", topics: ["dashboard"] }));
    };

    ws.onmessage = async (event) => {
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
          if (data.data?.workflowName) meta.workflow_name = data.data.workflowName;
          if (data.data?.nodeLabel) meta.node_label = data.data.nodeLabel;
          if (data.data?.senderNode) meta.sender_node = data.data.senderNode;
          if (data.data?.senderType) meta.sender_type = data.data.senderType;

          const fullContent =
            typeof data.data === "string"
              ? data.data
              : JSON.stringify(data.data ?? {}, null, 2);

          // Save full output to temp file
          const outputDir = join(process.cwd(), ".openconclave", "outputs");
          mkdirSync(outputDir, { recursive: true });
          const fileName = `output-${data.runId ?? "unknown"}-${Date.now()}.md`;
          const filePath = join(outputDir, fileName);
          writeFileSync(filePath, fullContent);
          meta.output_file = filePath;

          // Truncate inline content if too large
          const MAX_INLINE = 2000;
          const content = fullContent.length > MAX_INLINE
            ? fullContent.slice(0, MAX_INLINE) + `\n\n--- truncated (${fullContent.length} chars) ---\nFull output: ${filePath}`
            : fullContent;

          await mcp.server.notification({
            method: "notifications/claude/channel",
            params: { content, meta },
          });
        }

        if (eventType === "channel:improve-prompt") {
          const d = data.data ?? {};
          const content = [
            "A user wants you to improve an agent's system prompt in OpenConclave.",
            "",
            `Workflow ID: ${d.workflowId}`,
            `Node ID: ${d.nodeId}`,
            `Node Label: ${d.nodeLabel}`,
            "",
            "Current prompt:",
            d.currentPrompt || "(empty)",
            "",
            "Please write an improved version of this system prompt — make it clearer, more effective, and well-structured.",
            "Then call `update_node` to save it:",
            `  update_node(workflowId: "${d.workflowId}", nodeId: "${d.nodeId}", config: { systemPrompt: "your improved prompt" })`,
          ].join("\n");

          await mcp.server.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: {
                event_type: "channel:improve-prompt",
                workflow_id: String(d.workflowId),
                node_id: String(d.nodeId),
                node_label: String(d.nodeLabel),
              },
            },
          });
        }

        if (eventType === "channel:improve-description") {
          const d = data.data ?? {};
          const content = [
            "A user wants you to improve the workflow-level Instructions for Claude in OpenConclave.",
            "",
            `Workflow ID: ${d.workflowId}`,
            "",
            "Current instructions:",
            d.currentDescription || "(empty)",
            "",
            "Please write an improved version — make it clearer, more effective, and well-structured.",
            "Then call `update_workflow` to save it:",
            `  update_workflow(workflowId: "${d.workflowId}", description: "your improved instructions")`,
          ].join("\n");

          await mcp.server.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: {
                event_type: "channel:improve-description",
                workflow_id: String(d.workflowId),
              },
            },
          });
        }

        if (eventType === "channel:improve-code") {
          const d = data.data ?? {};
          const content = [
            "A user wants you to write or improve code for a Code node in OpenConclave.",
            "",
            `Workflow ID: ${d.workflowId}`,
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
            `  update_node(workflowId: "${d.workflowId}", nodeId: "${d.nodeId}", config: { code: "your code here" })`,
          ].join("\n");

          await mcp.server.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: {
                event_type: "channel:improve-code",
                workflow_id: String(d.workflowId),
                node_id: String(d.nodeId),
                node_label: String(d.nodeLabel),
              },
            },
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => setTimeout(connectWebSocket, 5000);
    ws.onerror = () => {};
  } catch {
    setTimeout(connectWebSocket, 5000);
  }
}

connectWebSocket();
