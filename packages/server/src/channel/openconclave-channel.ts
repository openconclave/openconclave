#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const OC_URL = process.env.OPENCONCLAVE_URL ?? "http://localhost:4000";
const OC_WS_URL = process.env.OPENCONCLAVE_WS_URL ?? "ws://localhost:4000";

// ── MCP Server with channel capability ───────────────────────

const mcp = new Server(
  { name: "openconclave", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: [
      'Events from OpenConclave arrive as <channel source="openconclave" event_type="..." ...>.',
      "",
      "Event types:",
      "- channel:output — a workflow produced output for you. Read and present to user.",
      "- prompt:question — a workflow is asking YOU a question and waiting for your response. You MUST respond using oc_respond with the run_id and node_id from the event attributes. The workflow is paused until you respond.",
      "",
      "Tools:",
      "- oc_list_workflows: see all workflows",
      "- oc_trigger_workflow: start a workflow run with optional payload",
      "- oc_get_run: get run details",
      "- oc_list_runs: list recent runs",
      "- oc_respond: respond to a pending prompt question (REQUIRED when you receive prompt:question events)",
      "- oc_pending_prompts: list all prompts waiting for response",
      "",
      "IMPORTANT: When you receive a prompt:question event, respond immediately using oc_respond. The workflow is blocked until you do.",
    ].join("\n"),
  }
);

// ── Tools: let Claude interact with OpenConclave ─────────────

async function ocApi(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${OC_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "oc_list_workflows",
      description: "List all workflows in OpenConclave",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "oc_trigger_workflow",
      description: "Trigger a workflow run in OpenConclave",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: { type: "string", description: "The workflow ID to trigger" },
          payload: {
            type: "object",
            description: "Optional payload data to pass to the workflow",
            additionalProperties: true,
          },
        },
        required: ["workflow_id"],
      },
    },
    {
      name: "oc_get_run",
      description: "Get details of a specific workflow run including tasks and events",
      inputSchema: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "The run ID" },
        },
        required: ["run_id"],
      },
    },
    {
      name: "oc_list_runs",
      description: "List recent workflow runs",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
    {
      name: "oc_respond",
      description: "Respond to a pending prompt question from a workflow. When a workflow has a Prompt node, it pauses and asks a question via the channel. Use this tool to send your response back so the workflow can continue.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "The run ID" },
          node_id: { type: "string", description: "The prompt node ID" },
          response: { type: "string", description: "Your response to the question" },
        },
        required: ["run_id", "node_id", "response"],
      },
    },
    {
      name: "oc_pending_prompts",
      description: "List all pending prompt questions waiting for responses",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case "oc_list_workflows": {
      const data = await ocApi("/workflows");
      const summary = (data.workflows ?? []).map((w: any) => ({
        id: w.id,
        name: w.name,
        enabled: w.enabled,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }

    case "oc_trigger_workflow": {
      const { workflow_id, payload } = args as { workflow_id: string; payload?: unknown };
      const data = await ocApi(`/workflows/${workflow_id}/run`, "POST", { payload });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "oc_get_run": {
      const { run_id } = args as { run_id: string };
      const data = await ocApi(`/runs/${run_id}`);
      const run = data.run;
      const tasks = (data.tasks ?? []).map((t: any) => ({
        id: t.id,
        nodeId: t.nodeId,
        status: t.status,
        model: t.model,
        prompt: t.prompt?.slice(0, 100),
        output: t.output?.slice(0, 300),
        costUsd: t.costUsd,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ run, tasks }, null, 2) }],
      };
    }

    case "oc_list_runs": {
      const { limit } = (args ?? {}) as { limit?: number };
      const data = await ocApi(`/runs?limit=${limit ?? 10}`);
      const summary = (data.runs ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        workflowId: r.workflowId,
        createdAt: r.createdAt,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }

    case "oc_respond": {
      const { run_id, node_id, response } = args as { run_id: string; node_id: string; response: string };
      const data = await ocApi("/prompts/respond", "POST", { runId: run_id, nodeId: node_id, response });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "oc_pending_prompts": {
      const data = await ocApi("/prompts/pending");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ── Connect to Claude Code ───────────────────────────────────

await mcp.connect(new StdioServerTransport());

// ── WebSocket: subscribe to OpenConclave events ──────────────

function connectWebSocket() {
  try {
    const ws = new WebSocket(OC_WS_URL);

    ws.onopen = () => {
      // Subscribe to all dashboard events
      ws.send(JSON.stringify({ type: "subscribe", topics: ["dashboard"] }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data.toString());
        const eventType = data.type as string;

        // Forward output events and prompt questions
        if (
          eventType === "channel:output" || eventType === "prompt:question"
        ) {
          const meta: Record<string, string> = {
            event_type: eventType,
            run_id: data.runId ?? "",
          };
          if (data.nodeId) meta.node_id = data.nodeId;
          if (data.data?.taskId) meta.task_id = data.data.taskId;
          if (data.data?.status) meta.status = data.data.status;
          if (data.data?.success !== undefined) meta.success = String(data.data.success);
          if (data.data?.durationMs) meta.duration_ms = String(data.data.durationMs);
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

          await mcp.notification({
            method: "notifications/claude/channel",
            params: { content, meta },
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      // Reconnect after 5 seconds
      setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = () => {
      // Will trigger onclose
    };
  } catch {
    setTimeout(connectWebSocket, 5000);
  }
}

connectWebSocket();
