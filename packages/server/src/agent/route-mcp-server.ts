#!/usr/bin/env bun
/**
 * Tiny MCP server that exposes openconclave_next tool for agent routing.
 * Spawned per-agent-run with route targets passed via ROUTE_TARGETS env var.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const targets = JSON.parse(process.env.ROUTE_TARGETS ?? "[]") as Array<{
  nodeId: string;
  label: string;
  type: string;
}>;

const validIds = targets.map((t) => t.nodeId);
const routeDescription = targets
  .map((t) => `"${t.nodeId}" → ${t.label} (${t.type})`)
  .join(", ");

const server = new McpServer({
  name: "openconclave-router",
  version: "0.1.0",
});

server.tool(
  "openconclave_next",
  `Route to the next workflow step. Available routes: ${routeDescription}. You MUST call this exactly once to choose where to go next.`,
  {
    node_id: z.enum(validIds as [string, ...string[]]).describe("The ID of the next node to route to"),
    content: z.string().describe("Your output message to pass to the next node"),
  },
  async ({ node_id, content }) => {
    // Output the route decision as a structured response
    return {
      content: [{ type: "text", text: `ROUTE:${node_id}:${content}` }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
