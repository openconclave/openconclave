import type { OllamaTool } from "./ollama-types";
import type { RouteTarget } from "../engine/types";
import { ROUTING_TOOL_NAME } from "./constants";

export function createOllamaRoutingTool(routeTargets: RouteTarget[]): {
  tool: OllamaTool;
  execute: (args: Record<string, unknown>) => Promise<string>;
} {
  const routeList = routeTargets
    .map((r) => `  - "${r.nodeId}" → ${r.label} (${r.type})`)
    .join("\n");
  const validIds = routeTargets.map((r) => r.nodeId);

  return {
    tool: {
      type: "function",
      function: {
        name: ROUTING_TOOL_NAME,
        description: `Route to the next conclave step.\nAvailable routes:\n${routeList}`,
        parameters: {
          type: "object",
          required: ["node_id", "content"],
          properties: {
            node_id: {
              type: "string",
              enum: validIds,
              description: "The node ID to route to (must be one of the available routes)",
            },
            content: {
              type: "string",
              description: "Your output message to pass to the next node",
              maxLength: 500_000,
            },
          },
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      if (typeof args.node_id !== "string" || !validIds.includes(args.node_id)) {
        return `Error: invalid node_id "${String(args.node_id)}". Valid targets: ${validIds.join(", ")}`;
      }
      if (typeof args.content !== "string") {
        return `Error: "content" must be a string`;
      }
      if (args.content.length > 500_000) {
        return `Error: "content" exceeds maximum length of 500,000 characters`;
      }
      return `ROUTE:${args.node_id}:${args.content}`;
    },
  };
}
