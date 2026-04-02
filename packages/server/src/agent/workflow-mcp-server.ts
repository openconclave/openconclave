#!/usr/bin/env bun
/**
 * OpenConclave Workflow MCP Server
 *
 * Provides workflow-aware tools to agents running inside a workflow.
 * Each agent run gets its own instance with context about available
 * routes, conversation history, and workflow state.
 *
 * Communication: agent calls tools via MCP, server writes decisions
 * to a state file that the executor reads after agent completes.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { z } from "zod";

// Config passed via environment
const STATE_FILE = process.env.OC_STATE_FILE ?? "";
const ROUTE_TARGETS = JSON.parse(process.env.OC_ROUTE_TARGETS ?? "[]") as Array<{
  nodeId: string;
  label: string;
  type: string;
}>;
const CONVERSATION_HISTORY = JSON.parse(process.env.OC_CONVERSATION_HISTORY ?? "[]") as Array<{
  role: string;
  content: string;
}>;

// State that gets written back to the executor
interface WorkflowState {
  routeTo?: string;
  routeContent?: string;
}

function writeState(state: WorkflowState) {
  if (STATE_FILE) {
    writeFileSync(STATE_FILE, JSON.stringify(state));
  }
}

// ── Server ───────────────────────────────────────────────────

const server = new McpServer({
  name: "openconclave-workflow",
  version: "0.1.0",
});

// ── Routing Tool ─────────────────────────────────────────────

if (ROUTE_TARGETS.length >= 2) {
  const validIds = ROUTE_TARGETS.map((t) => t.nodeId);
  const routeDescription = ROUTE_TARGETS
    .map((t) => {
      const desc = (t as Record<string, unknown>).description as string | undefined;
      return `  - "${t.nodeId}" → ${t.label} (${t.type})${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");

  server.tool(
    "openconclave_next",
    [
      "Choose the next step in the workflow. You MUST call this exactly once when you are done.",
      "Available routes:",
      routeDescription,
    ].join("\n"),
    {
      node_id: z.enum(validIds as [string, ...string[]]).describe("The ID of the next node to route to"),
      content: z.string().describe("Your output message to pass to the next node"),
    },
    async ({ node_id, content }) => {
      writeState({ routeTo: node_id, routeContent: content });
      const target = ROUTE_TARGETS.find((t) => t.nodeId === node_id);
      return {
        content: [{ type: "text", text: `Routing to: ${target?.label ?? node_id}` }],
      };
    }
  );
}

// ── Conversation History Tool ────────────────────────────────

if (CONVERSATION_HISTORY.length > 0) {
  server.tool(
    "openconclave_history",
    "Get the conversation history from previous turns in this workflow loop.",
    {},
    async () => {
      const formatted = CONVERSATION_HISTORY
        .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`)
        .join("\n\n");
      return {
        content: [{ type: "text", text: formatted }],
      };
    }
  );
}

// ── Connect ──────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
