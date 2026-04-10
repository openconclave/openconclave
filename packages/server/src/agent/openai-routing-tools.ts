import type { OpenAITool } from "./openai-types";

type RouteTarget = { nodeId: string; label: string; type: string };

function routingParams(routeTargets: RouteTarget[]): {
  desc: string;
  params: {
    type: "object";
    required: string[];
    properties: Record<string, unknown>;
  };
} {
  const routeList = routeTargets
    .map((r) => `  - "${r.nodeId}" → ${r.label} (${r.type})`)
    .join("\n");
  const desc = `Route to the next conclave step. You MUST call this exactly once.\nAvailable routes:\n${routeList}`;
  const params = {
    type: "object" as const,
    required: ["node_id", "content"],
    properties: {
      node_id: { type: "string", enum: routeTargets.map((r) => r.nodeId), description: "The node ID to route to" },
      content: { type: "string", description: "Your output message to pass to the next node" },
    },
  };
  return { desc, params };
}

/** Chat Completions format — tool nested under `function` key */
export function createRoutingToolChat(routeTargets: RouteTarget[]): OpenAITool {
  const { desc, params } = routingParams(routeTargets);
  return { type: "function", function: { name: "openconclave_next", description: desc, parameters: params } };
}

/** Responses API format — name/description at top level */
export function createRoutingToolResponses(routeTargets: RouteTarget[]): Record<string, unknown> {
  const { desc, params } = routingParams(routeTargets);
  return { type: "function", name: "openconclave_next", description: desc, parameters: params };
}
