import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "../db/client";
import { workflows, runs, agentTasks, runEvents, mcpServers } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { WorkflowExecutor } from "../engine/executor";

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
      const result = await db.select().from(workflows);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              result.map((w) => ({
                id: w.id,
                name: w.name,
                description: w.description,
                enabled: w.enabled,
                createdAt: w.createdAt,
                updatedAt: w.updatedAt,
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_workflow",
    "Get a workflow's full definition including nodes and edges",
    { workflowId: z.string().describe("The workflow ID") },
    async ({ workflowId }) => {
      const result = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (!result.length) {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(result[0], null, 2) }] };
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
      const id = nanoid();
      const now = new Date().toISOString();
      const definition = { id, name, description, nodes, edges, enabled: true, createdAt: now, updatedAt: now };

      await db.insert(workflows).values({
        id,
        name,
        description,
        definition,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });

      return { content: [{ type: "text", text: JSON.stringify({ id, name, status: "created" }, null, 2) }] };
    }
  );

  server.tool(
    "update_workflow",
    "Update an existing workflow's name, description, enabled status, nodes, or edges",
    {
      workflowId: z.string().describe("The workflow ID to update"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      enabled: z.boolean().optional().describe("Enable or disable the workflow"),
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
        .optional()
        .describe("Updated nodes"),
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
        .optional()
        .describe("Updated edges"),
    },
    async ({ workflowId, name, description, enabled, nodes, edges }) => {
      const existing = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (!existing.length) {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }

      const prev = existing[0];
      const now = new Date().toISOString();
      const prevDef = prev.definition as Record<string, unknown>;

      const updated = {
        name: name ?? prev.name,
        description: description ?? prev.description,
        enabled: enabled ?? prev.enabled,
        definition: {
          ...prevDef,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(enabled !== undefined && { enabled }),
          ...(nodes !== undefined && { nodes }),
          ...(edges !== undefined && { edges }),
          updatedAt: now,
        },
        updatedAt: now,
      };

      await db.update(workflows).set(updated).where(eq(workflows.id, workflowId));
      return { content: [{ type: "text", text: JSON.stringify({ id: workflowId, status: "updated" }, null, 2) }] };
    }
  );

  server.tool(
    "delete_workflow",
    "Delete a workflow by ID",
    { workflowId: z.string().describe("The workflow ID to delete") },
    async ({ workflowId }) => {
      await db.delete(workflows).where(eq(workflows.id, workflowId));
      return { content: [{ type: "text", text: JSON.stringify({ id: workflowId, status: "deleted" }) }] };
    }
  );

  // ── Runs ───────────────────────────────────────────────────

  server.tool(
    "trigger_workflow",
    "Trigger a workflow run manually",
    {
      workflowId: z.string().describe("The workflow ID to trigger"),
      payload: z.record(z.unknown()).optional().describe("Optional trigger payload data"),
    },
    async ({ workflowId, payload }) => {
      const wf = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (!wf.length) {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }

      const executor = new WorkflowExecutor();
      const definition = wf[0].definition as any;
      const runId = await executor.execute(definition, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ runId, workflowId, status: "running", message: "Workflow run started" }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_runs",
    "List workflow runs, optionally filtered by workflow ID or status",
    {
      workflowId: z.string().optional().describe("Filter by workflow ID"),
      status: z.enum(["queued", "running", "success", "failure", "cancelled"]).optional().describe("Filter by status"),
      limit: z.number().int().positive().max(100).default(20).describe("Max results"),
    },
    async ({ workflowId, status, limit }) => {
      let query = db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit);
      // Apply filters manually since drizzle chaining with conditionals is verbose
      const result = await query;
      const filtered = result.filter((r) => {
        if (workflowId && r.workflowId !== workflowId) return false;
        if (status && r.status !== status) return false;
        return true;
      });

      return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
    }
  );

  server.tool(
    "get_run",
    "Get details of a specific run including its agent tasks and events",
    { runId: z.string().describe("The run ID") },
    async ({ runId }) => {
      const run = await db.select().from(runs).where(eq(runs.id, runId));
      if (!run.length) {
        return { content: [{ type: "text", text: "Run not found" }], isError: true };
      }

      const tasks = await db.select().from(agentTasks).where(eq(agentTasks.runId, runId));
      const events = await db.select().from(runEvents).where(eq(runEvents.runId, runId));

      return {
        content: [{ type: "text", text: JSON.stringify({ run: run[0], tasks, events }, null, 2) }],
      };
    }
  );

  server.tool(
    "cancel_run",
    "Cancel a running workflow",
    { runId: z.string().describe("The run ID to cancel") },
    async ({ runId }) => {
      const now = new Date().toISOString();
      await db.update(runs).set({ status: "cancelled", completedAt: now }).where(eq(runs.id, runId));
      await db
        .update(agentTasks)
        .set({ status: "cancelled", completedAt: now })
        .where(eq(agentTasks.runId, runId));

      return { content: [{ type: "text", text: JSON.stringify({ runId, status: "cancelled" }) }] };
    }
  );

  // ── Agents ─────────────────────────────────────────────────

  server.tool(
    "get_agent_status",
    "Get the current status of all running and queued agent tasks",
    {},
    async () => {
      const running = await db.select().from(agentTasks).where(eq(agentTasks.status, "running"));
      const queued = await db.select().from(agentTasks).where(eq(agentTasks.status, "queued"));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { running: running.length, queued: queued.length, runningTasks: running, queuedTasks: queued },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── Dashboard ──────────────────────────────────────────────

  server.tool(
    "get_dashboard",
    "Get an overview of OpenConclave: workflow count, active runs, recent activity",
    {},
    async () => {
      const allWorkflows = await db.select().from(workflows);
      const allRuns = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(20);
      const allTasks = await db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt)).limit(20);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalWorkflows: allWorkflows.length,
                activeRuns: allRuns.filter((r) => r.status === "running").length,
                queuedRuns: allRuns.filter((r) => r.status === "queued").length,
                recentRuns: allRuns,
                recentTasks: allTasks,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── MCP Server Registry ────────────────────────────────────

  server.tool(
    "list_mcp_servers",
    "List all registered external MCP servers that agents can use",
    {},
    async () => {
      const result = await db.select().from(mcpServers);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "register_mcp_server",
    "Register an external MCP server for agents to use",
    {
      name: z.string().describe("Unique name for this MCP server"),
      type: z.enum(["stdio", "sse", "http"]).describe("Transport type"),
      config: z
        .record(z.unknown())
        .describe("Server config: for stdio include 'command' and 'args', for sse/http include 'url'"),
    },
    async ({ name, type, config }) => {
      const now = new Date().toISOString();
      await db.insert(mcpServers).values({ name, type, config, enabled: true, createdAt: now });
      return { content: [{ type: "text", text: JSON.stringify({ name, status: "registered" }) }] };
    }
  );

  server.tool(
    "remove_mcp_server",
    "Remove a registered MCP server",
    { name: z.string().describe("The MCP server name to remove") },
    async ({ name }) => {
      await db.delete(mcpServers).where(eq(mcpServers.name, name));
      return { content: [{ type: "text", text: JSON.stringify({ name, status: "removed" }) }] };
    }
  );

  // ── Scheduler / Cron ────────────────────────────────────────

  server.tool(
    "get_schedule",
    "List all scheduled cron workflows with their next run time",
    {},
    async () => {
      try {
        const res = await fetch("http://localhost:4000/api/scheduler");
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify(data.schedule, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Scheduler not available (server not running?)" }], isError: true };
      }
    }
  );

  server.tool(
    "pause_workflow",
    "Pause a workflow — disables it and stops its cron schedule",
    { workflowId: z.string().describe("The workflow ID to pause") },
    async ({ workflowId }) => {
      const existing = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (!existing.length) {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }

      await db.update(workflows).set({ enabled: false, updatedAt: new Date().toISOString() }).where(eq(workflows.id, workflowId));

      try { await fetch("http://localhost:4000/api/scheduler/sync", { method: "POST" }); } catch {}

      return { content: [{ type: "text", text: JSON.stringify({ id: workflowId, name: existing[0].name, status: "paused" }, null, 2) }] };
    }
  );

  server.tool(
    "resume_workflow",
    "Resume a paused workflow — enables it and restarts its cron schedule",
    { workflowId: z.string().describe("The workflow ID to resume") },
    async ({ workflowId }) => {
      const existing = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (!existing.length) {
        return { content: [{ type: "text", text: "Workflow not found" }], isError: true };
      }

      await db.update(workflows).set({ enabled: true, updatedAt: new Date().toISOString() }).where(eq(workflows.id, workflowId));

      try { await fetch("http://localhost:4000/api/scheduler/sync", { method: "POST" }); } catch {}

      const schedRes = await fetch("http://localhost:4000/api/scheduler").then(r => r.json()).catch(() => ({ schedule: [] })) as any;
      const sched = (schedRes.schedule ?? []).find((s: any) => s.workflowId === workflowId);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: workflowId,
            name: existing[0].name,
            status: "resumed",
            nextRun: sched?.nextRun ?? null,
          }, null, 2),
        }],
      };
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
