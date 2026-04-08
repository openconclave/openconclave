import { describe, it, expect } from "vitest";
import { createOllamaRoutingTool } from "../ollama-routing";

const routes = [
  { nodeId: "node-a", label: "Branch A", type: "prompt" },
  { nodeId: "node-b", label: "Branch B", type: "output" },
];

describe("createOllamaRoutingTool", () => {
  it("returns a function-type tool with name openconclave_next", () => {
    const { tool } = createOllamaRoutingTool(routes);
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("openconclave_next");
  });

  it("description lists all route node IDs and labels", () => {
    const { tool } = createOllamaRoutingTool(routes);
    expect(tool.function.description).toContain("node-a");
    expect(tool.function.description).toContain("node-b");
    expect(tool.function.description).toContain("Branch A");
    expect(tool.function.description).toContain("Branch B");
  });

  it("parameters require node_id and content", () => {
    const { tool } = createOllamaRoutingTool(routes);
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
    const { tool } = createOllamaRoutingTool(routes);
    const params = tool.function.parameters as {
      properties: { node_id: { enum: string[] } };
    };
    expect(params.properties.node_id.enum).toEqual(["node-a", "node-b"]);
  });

  it("execute returns ROUTE:<node_id>:<content>", async () => {
    const { execute } = createOllamaRoutingTool(routes);
    const result = await execute({ node_id: "node-a", content: "hello" });
    expect(result).toBe("ROUTE:node-a:hello");
  });

  it("handles a single route target", () => {
    const single = [{ nodeId: "only", label: "Only", type: "prompt" }];
    const { tool } = createOllamaRoutingTool(single);
    expect(tool.function.name).toBe("openconclave_next");
  });
});
