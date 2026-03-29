#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
      'These are workflow output events from "Claude Code (channel)" output nodes.',
      "",
      "Event types:",
      '- channel:output — a workflow produced output for you. Contains the result data.',
      "",
      "You can interact with OpenConclave using these tools:",
      "- oc_list_workflows: see all workflows",
      '- oc_trigger_workflow: start a workflow run. Pass workflow_id and optional payload. Workflows with "channel" trigger type are designed to be triggered from here — the payload becomes the input for the first agent.',
      "- oc_get_run: get details of a specific run",
      "- oc_list_runs: list recent runs",
      "",
      "When you receive a channel:output event, it means a workflow finished and sent you its result. Read the content and act on it or present it to the user.",
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

        // Only forward claude-code output events — nothing else buzzes the session
        if (
          eventType === "channel:output"
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

          const content =
            typeof data.data === "string"
              ? data.data.slice(0, 500)
              : JSON.stringify(data.data ?? {}).slice(0, 500);

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
