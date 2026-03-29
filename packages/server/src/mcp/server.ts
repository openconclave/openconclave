import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OC_URL = process.env.OPENCONCLAVE_URL ?? "http://localhost:4000";

async function ocApi(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const res = await fetch(`${OC_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function createMcpServer() {
  const server = new McpServer({
    name: "openconclave",
    version: "0.1.0",
  });

  // ── Workflows ──────────────────────────────────────────────

  server.tool(
    "list_workflows",
    "List all workflows in OpenConclave",
    {},
    async () => {
      const data = await ocApi("/workflows") as { workflows: unknown[] };
      const summary = data.workflows.map((w: Record<string, unknown>) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        enabled: w.enabled,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool(
    "get_workflow",
    "Get a workflow's full definition including nodes and edges",
    { workflowId: z.string().describe("The workflow ID") },
    async ({ workflowId }) => {
      try {
        const data = await ocApi(`/workflows/${workflowId}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }
    }
  );

  server.tool(
    "create_workflow",
    "Create a new workflow with nodes and edges",
    {
      name: z.string().describe("Workflow name"),
      description: z.string().optional().describe("Workflow description"),
      nodes: z
        .array(
          z.object({
            id: z.string(),
            type: z.enum(["trigger", "agent", "condition", "transform", "output"]),
            position: z.object({ x: z.number(), y: z.number() }),
            data: z.object({
              label: z.string(),
              type: z.enum(["trigger", "agent", "condition", "transform", "output"]),
              config: z.record(z.unknown()),
            }),
          })
        )
        .describe("Workflow nodes"),
      edges: z
        .array(
          z.object({
            id: z.string(),
            source: z.string(),
            target: z.string(),
            sourceHandle: z.string().optional(),
            label: z.string().optional(),
          })
        )
        .describe("Workflow edges connecting nodes"),
    },
    async ({ name, description, nodes, edges }) => {
      const data = await ocApi("/workflows", "POST", { name, description, nodes, edges });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_workflow",
    "Update an existing workflow's name, description, enabled status, nodes, or edges",
    {
      workflowId: z.string().describe("The workflow ID to update"),
      name: z.string().optional(),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      nodes: z.array(z.object({
        id: z.string(),
        type: z.enum(["trigger", "agent", "condition", "transform", "output"]),
        position: z.object({ x: z.number(), y: z.number() }),
        data: z.object({
          label: z.string(),
          type: z.enum(["trigger", "agent", "condition", "transform", "output"]),
          config: z.record(z.unknown()),
        }),
      })).optional(),
      edges: z.array(z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        sourceHandle: z.string().optional(),
        label: z.string().optional(),
      })).optional(),
    },
    async ({ workflowId, ...body }) => {
      try {
        const data = await ocApi(`/workflows/${workflowId}`, "PUT", body);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }
    }
  );

  server.tool(
    "delete_workflow",
    "Delete a workflow by ID",
    { workflowId: z.string().describe("The workflow ID to delete") },
    async ({ workflowId }) => {
      await ocApi(`/workflows/${workflowId}`, "DELETE");
      return { content: [{ type: "text", text: JSON.stringify({ id: workflowId, status: "deleted" }) }] };
    }
  );

  // ── Runs ───────────────────────────────────────────────────

  server.tool(
    "trigger_workflow",
    "Trigger a workflow run",
    {
      workflowId: z.string().describe("The workflow ID to trigger"),
      payload: z.record(z.unknown()).optional().describe("Optional trigger payload data"),
    },
    async ({ workflowId, payload }) => {
      try {
        const data = await ocApi(`/workflows/${workflowId}/run`, "POST", { payload });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }
    }
  );

  server.tool(
    "list_runs",
    "List workflow runs",
    {
      status: z.enum(["queued", "running", "success", "failure", "cancelled"]).optional(),
      limit: z.number().int().positive().max(100).default(20),
    },
    async () => {
      const data = await ocApi("/runs") as { runs: unknown[] };
      return { content: [{ type: "text", text: JSON.stringify(data.runs.slice(0, 20), null, 2) }] };
    }
  );

  server.tool(
    "get_run",
    "Get details of a specific run including its agent tasks and events",
    { runId: z.string().describe("The run ID") },
    async ({ runId }) => {
      try {
        const data = await ocApi(`/runs/${runId}`) as { run: unknown; tasks: unknown[]; events: unknown[] };
        // Summarize for readability
        const tasks = (data.tasks as Record<string, unknown>[]).map((t) => ({
          id: t.id,
          nodeId: t.nodeId,
          status: t.status,
          model: t.model,
          prompt: typeof t.prompt === "string" ? t.prompt.slice(0, 100) : t.prompt,
          output: typeof t.output === "string" ? t.output.slice(0, 300) : t.output,
          costUsd: t.costUsd,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ run: data.run, tasks }, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Run not found" }], isError: true };
      }
    }
  );

  server.tool(
    "cancel_run",
    "Cancel a running workflow",
    { runId: z.string().describe("The run ID to cancel") },
    async ({ runId }) => {
      await ocApi(`/runs/${runId}/cancel`, "POST");
      return { content: [{ type: "text", text: JSON.stringify({ runId, status: "cancelled" }) }] };
    }
  );

  // ── Agents ─────────────────────────────────────────────────

  server.tool(
    "get_agent_status",
    "Get the current status of all running and queued agent tasks",
    {},
    async () => {
      const data = await ocApi("/agents/status");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Dashboard ──────────────────────────────────────────────

  server.tool(
    "get_dashboard",
    "Get an overview of OpenConclave: workflow count, active runs, recent activity",
    {},
    async () => {
      const data = await ocApi("/dashboard");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Scheduler / Cron ───────────────────────────────────────

  server.tool(
    "get_schedule",
    "List all scheduled cron workflows with their next run time",
    {},
    async () => {
      try {
        const data = await ocApi("/scheduler");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Scheduler not available" }], isError: true };
      }
    }
  );

  server.tool(
    "pause_workflow",
    "Pause a workflow — disables it and stops its cron schedule",
    { workflowId: z.string().describe("The workflow ID to pause") },
    async ({ workflowId }) => {
      try {
        await ocApi(`/workflows/${workflowId}`, "PUT", { enabled: false });
        await ocApi("/scheduler/sync", "POST");
        return { content: [{ type: "text", text: JSON.stringify({ id: workflowId, status: "paused" }) }] };
      } catch {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }
    }
  );

  server.tool(
    "resume_workflow",
    "Resume a paused workflow — enables it and restarts its cron schedule",
    { workflowId: z.string().describe("The workflow ID to resume") },
    async ({ workflowId }) => {
      try {
        await ocApi(`/workflows/${workflowId}`, "PUT", { enabled: true });
        await ocApi("/scheduler/sync", "POST");
        const schedule = await ocApi("/scheduler") as { schedule: unknown[] };
        return { content: [{ type: "text", text: JSON.stringify({ id: workflowId, status: "resumed", schedule }, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }
    }
  );

  // ── MCP Server Registry ────────────────────────────────────

  server.tool(
    "list_mcp_servers",
    "List all registered external MCP servers",
    {},
    async () => {
      // This still needs direct API — add endpoint later
      return { content: [{ type: "text", text: "[]" }] };
    }
  );

  server.tool(
    "register_mcp_server",
    "Register an external MCP server for agents to use",
    {
      name: z.string(),
      type: z.enum(["stdio", "sse", "http"]),
      config: z.record(z.unknown()),
    },
    async () => {
      return { content: [{ type: "text", text: "MCP server registration via API not yet implemented" }] };
    }
  );

  server.tool(
    "remove_mcp_server",
    "Remove a registered MCP server",
    { name: z.string() },
    async () => {
      return { content: [{ type: "text", text: "MCP server removal via API not yet implemented" }] };
    }
  );

  return server;
}

// Run as standalone stdio MCP server when executed directly
if (import.meta.main) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
