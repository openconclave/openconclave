import type { OllamaTool } from "./ollama-types";

type RouteTarget = { nodeId: string; label: string; type: string };

/**
 * Creates the routing tool for Ollama agents.
 * The agent MUST call this exactly once to route to the next workflow step.
 */
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
        name: "openconclave_next",
        description: `Route to the next workflow step. You MUST call this exactly once.\nAvailable routes:\n${routeList}`,
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
            },
          },
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      return `ROUTE:${args.node_id}:${args.content}`;
    },
  };
}
