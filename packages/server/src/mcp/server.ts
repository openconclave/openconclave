import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NODE_TYPE_ALIASES, NODE_TYPES } from "@openconclave/shared/src/constants";
import { VERSION } from "@openconclave/shared";

const OC_URL = process.env.OPENCONCLAVE_URL ?? "http://localhost:4000";

// Accept every canonical node type plus legacy aliases (resolved by the
// conclave normalizer). Sourcing from shared's NODE_TYPES means new node
// types added to the editor auto-propagate here instead of drifting.
const legacyNodeTypes = Object.keys(NODE_TYPE_ALIASES) as string[];
const acceptedConclaveNodeTypes = [...NODE_TYPES, ...legacyNodeTypes] as [string, ...string[]];

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
    version: VERSION,
  });

  // ── Conclaves ──────────────────────────────────────────────

  server.tool(
    "list_conclaves",
    "List all conclaves in OpenConclave",
    {},
    async () => {
      const data = await ocApi("/conclaves") as { conclaves: unknown[] };
      const summary = (data.conclaves as Record<string, unknown>[]).map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        enabled: w.enabled,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool(
    "get_conclave",
    "Get a conclave's full definition including nodes and edges",
    { conclaveId: z.string().describe("The conclave ID") },
    async ({ conclaveId }) => {
      try {
        const data = await ocApi(`/conclaves/${conclaveId}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Conclave not found" }], isError: true };
      }
    }
  );

  server.tool(
    "create_conclave",
    "Create a new conclave with nodes and edges",
    {
      name: z.string().describe("Conclave name"),
      description: z.string().optional().describe("Conclave description"),
      nodes: z
        .array(
          z.object({
            id: z.string(),
            type: z.enum(acceptedConclaveNodeTypes),
            position: z.object({ x: z.number(), y: z.number() }),
            data: z.object({
              label: z.string(),
              type: z.enum(acceptedConclaveNodeTypes),
              config: z.record(z.unknown()),
            }),
          })
        )
        .describe("Conclave nodes"),
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
        .describe("Conclave edges connecting nodes"),
    },
    async ({ name, description, nodes, edges }) => {
      const data = await ocApi("/conclaves", "POST", { name, description, nodes, edges });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_conclave",
    "Update an existing conclave's name, description, enabled status, nodes, or edges",
    {
      conclaveId: z.string().describe("The conclave ID to update"),
      name: z.string().optional(),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      nodes: z.array(z.object({
        id: z.string(),
        type: z.enum(acceptedConclaveNodeTypes),
        position: z.object({ x: z.number(), y: z.number() }),
        data: z.object({
          label: z.string(),
          type: z.enum(acceptedConclaveNodeTypes),
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
    async ({ conclaveId, ...body }) => {
      try {
        const data = await ocApi(`/conclaves/${conclaveId}`, "PUT", body);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: e instanceof Error ? e.message : "Conclave not found" }], isError: true };
      }
    }
  );

  server.tool(
    "update_node",
    "Update a single node's config, label, or position in a conclave without replacing the whole definition. The config is shallow-merged into the existing node config, so passing { systemPrompt: \"...\" } preserves model, tools, and other fields.",
    {
      conclaveId: z.string().describe("The conclave ID"),
      nodeId: z.string().describe("The node ID to update"),
      config: z.record(z.unknown()).optional().describe("Partial config merged into the node's data.config"),
      label: z.string().optional().describe("New label for the node"),
      position: z.object({ x: z.number(), y: z.number() }).optional().describe("New position for the node"),
    },
    async ({ conclaveId, nodeId, config, label, position }) => {
      try {
        const current = await ocApi(`/conclaves/${conclaveId}`) as {
          definition: {
            nodes: Array<{
              id: string;
              type: string;
              position: { x: number; y: number };
              data: { label: string; type: string; config: Record<string, unknown> };
            }>;
          };
        };
        const nodes = [...current.definition.nodes];
        const idx = nodes.findIndex((n) => n.id === nodeId);
        if (idx === -1) {
          return { content: [{ type: "text", text: `Node "${nodeId}" not found in conclave ${conclaveId}` }], isError: true };
        }
        const node = nodes[idx]!;
        const updatedNode = {
          ...node,
          ...(position ? { position } : {}),
          data: {
            ...node.data,
            ...(label !== undefined ? { label } : {}),
            config: config ? { ...node.data.config, ...config } : node.data.config,
          },
        };
        nodes[idx] = updatedNode;
        await ocApi(`/conclaves/${conclaveId}`, "PUT", { nodes });
        return { content: [{ type: "text", text: JSON.stringify({ nodeId, updated: updatedNode.data }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: e instanceof Error ? e.message : "Update failed" }], isError: true };
      }
    }
  );

  server.tool(
    "delete_conclave",
    "Delete a conclave by ID",
    { conclaveId: z.string().describe("The conclave ID to delete") },
    async ({ conclaveId }) => {
      await ocApi(`/conclaves/${conclaveId}`, "DELETE");
      return { content: [{ type: "text", text: JSON.stringify({ id: conclaveId, status: "deleted" }) }] };
    }
  );

  // ── Runs ───────────────────────────────────────────────────

  server.tool(
    "trigger_conclave",
    "Trigger a conclave run. Always pass your current working directory as cwd so agents run in the correct project.",
    {
      conclaveId: z.string().describe("The conclave ID to trigger"),
      payload: z.record(z.unknown()).optional().describe("Optional trigger payload data"),
      cwd: z.string().describe("Your current working directory — agents will run here"),
    },
    async ({ conclaveId, payload, cwd }) => {
      try {
        const enrichedPayload = { ...(payload ?? {}), ...(cwd ? { _callerCwd: cwd } : {}) };
        const data = await ocApi(`/conclaves/${conclaveId}/run`, "POST", { payload: enrichedPayload });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Conclave not found" }], isError: true };
      }
    }
  );

  server.tool(
    "list_runs",
    "List conclave runs",
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
    "Cancel a running conclave",
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
    "Get an overview of OpenConclave: conclave count, active runs, recent activity",
    {},
    async () => {
      const data = await ocApi("/dashboard");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Scheduler / Cron ───────────────────────────────────────

  server.tool(
    "get_schedule",
    "List all scheduled cron conclaves with their next run time",
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
    "pause_conclave",
    "Pause a conclave — disables it and stops its cron schedule",
    { conclaveId: z.string().describe("The conclave ID to pause") },
    async ({ conclaveId }) => {
      try {
        await ocApi(`/conclaves/${conclaveId}`, "PUT", { enabled: false });
        await ocApi("/scheduler/sync", "POST");
        return { content: [{ type: "text", text: JSON.stringify({ id: conclaveId, status: "paused" }) }] };
      } catch {
        return { content: [{ type: "text", text: "Conclave not found" }], isError: true };
      }
    }
  );

  server.tool(
    "resume_conclave",
    "Resume a paused conclave — enables it and restarts its cron schedule",
    { conclaveId: z.string().describe("The conclave ID to resume") },
    async ({ conclaveId }) => {
      try {
        await ocApi(`/conclaves/${conclaveId}`, "PUT", { enabled: true });
        await ocApi("/scheduler/sync", "POST");
        const schedule = await ocApi("/scheduler") as { schedule: unknown[] };
        return { content: [{ type: "text", text: JSON.stringify({ id: conclaveId, status: "resumed", schedule }, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Conclave not found" }], isError: true };
      }
    }
  );

  // ── Claude-in-the-loop (replaces channel plugin) ──────────

  server.tool(
    "list_pending_prompts",
    "List all prompt:question events currently awaiting a response from Claude. Use this after reconnecting to catch up on anything in flight.",
    {},
    async () => {
      const data = await ocApi("/prompts/pending");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "respond_to_prompt",
    "Answer a pending prompt:question so the blocked conclave run can continue. Pass the exact runId and nodeId surfaced in the plugin event file (or by list_pending_prompts).",
    {
      runId: z.number().describe("Run ID that emitted the prompt:question event"),
      nodeId: z.string().describe("Node ID inside that run that is waiting"),
      response: z.string().describe("Text sent back to the blocked agent"),
    },
    async ({ runId, nodeId, response }) => {
      const data = await ocApi("/prompts/respond", "POST", { runId, nodeId, response });
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
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

// ── Dynamic conclave tools ───────────────────────────────────
//
// Every enabled conclave with a `toolName` in its definition becomes its own
// MCP tool (e.g. `the_ledger`, `mafia_game_v2`). Claude can then call a
// conclave directly by name instead of remembering its ID + trigger_conclave.
//
// Static registration only at stdio startup — new conclaves appear after
// /reload-plugins (which respawns the MCP server). Best effort: if the OC
// server isn't up yet, we log and skip; tools appear on next reload.
async function registerConclaveTools(server: ReturnType<typeof createMcpServer>): Promise<void> {
  try {
    const data = await ocApi("/conclaves") as { conclaves?: Array<Record<string, unknown>> };
    const list = data.conclaves ?? [];
    for (const wf of list) {
      if (!wf.enabled) continue;
      const def = (wf.definition ?? {}) as Record<string, unknown>;
      const toolName = (def.toolName ?? wf.toolName) as string | undefined;
      if (!toolName) continue;
      const description = String(def.description ?? wf.description ?? `Run conclave: ${wf.name}`);
      const conclaveId = String(wf.id);

      server.tool(
        toolName,
        `${description}. Always pass your current working directory as cwd so agents run in the correct project.`,
        {
          input: z.string().optional().describe("Input data to pass to the conclave trigger"),
          cwd: z.string().describe("Your current working directory — agents will run here"),
        },
        async ({ input, cwd }) => {
          const payload = {
            ...(input ? { input } : {}),
            ...(cwd ? { _callerCwd: cwd } : {}),
          };
          const result = await ocApi(`/conclaves/${conclaveId}/run`, "POST", { payload });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
      );
    }
  } catch (err) {
    // Server not up yet, or API blip. Static tools still work.
    process.stderr.write(`[mcp] conclave tool sync skipped: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// Run as standalone stdio MCP server when imported with ?stdio flag or executed directly
export async function startStdio() {
  const server = createMcpServer();
  await registerConclaveTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
