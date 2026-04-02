import { describe, it, expect } from "vitest";
import { createRoutingToolChat, createRoutingToolResponses } from "./openai-routing-tools";

const routes = [
  { nodeId: "node-a", label: "Branch A", type: "prompt" },
  { nodeId: "node-b", label: "Branch B", type: "output" },
];

describe("createRoutingToolChat", () => {
  it("returns a function-type tool with name openconclave_next", () => {
    const tool = createRoutingToolChat(routes);
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("openconclave_next");
  });

  it("description lists all route node IDs", () => {
    const tool = createRoutingToolChat(routes);
    expect(tool.function.description).toContain("node-a");
    expect(tool.function.description).toContain("node-b");
    expect(tool.function.description).toContain("Branch A");
    expect(tool.function.description).toContain("Branch B");
  });

  it("parameters require node_id and content", () => {
    const tool = createRoutingToolChat(routes);
    const params = tool.function.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toContain("node_id");
    expect(params.required).toContain("content");
    expect(params.properties).toHaveProperty("node_id");
    expect(params.properties).toHaveProperty("content");
  });

  it("node_id enum contains all route node IDs", () => {
    const tool = createRoutingToolChat(routes);
    const params = tool.function.parameters as {
      properties: { node_id: { enum: string[] } };
    };
    expect(params.properties.node_id.enum).toEqual(["node-a", "node-b"]);
  });

  it("handles a single route target", () => {
    const single = [{ nodeId: "only", label: "Only", type: "prompt" }];
    const tool = createRoutingToolChat(single);
    expect(tool.function.name).toBe("openconclave_next");
  });
});

describe("createRoutingToolResponses", () => {
  it("returns an object with name at top level (not nested under function)", () => {
    const tool = createRoutingToolResponses(routes);
    expect(tool.type).toBe("function");
    expect(tool.name).toBe("openconclave_next");
    // Must NOT have a nested `function` key
    expect(tool).not.toHaveProperty("function");
  });

  it("description lists all route node IDs", () => {
    const tool = createRoutingToolResponses(routes);
    expect(tool.description as string).toContain("node-a");
    expect(tool.description as string).toContain("node-b");
  });

  it("parameters require node_id and content", () => {
    const tool = createRoutingToolResponses(routes);
    const params = tool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toContain("node_id");
    expect(params.required).toContain("content");
  });

  it("node_id enum contains all route node IDs", () => {
    const tool = createRoutingToolResponses(routes);
    const params = tool.parameters as {
      properties: { node_id: { enum: string[] } };
    };
    expect(params.properties.node_id.enum).toEqual(["node-a", "node-b"]);
  });
});
