#!/usr/bin/env bun
/**
 * Dynamic Tools MCP Server
 *
 * Registers arbitrary tool definitions passed via OC_DYNAMIC_TOOLS env var.
 * When an agent calls any tool, writes {tool_name, tool_input} to OC_STATE_FILE.
 * Used by the invoke endpoint to give agents structured output tools.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync } from "fs";
import { z } from "zod";

const STATE_FILE = process.env.OC_STATE_FILE ?? "";
const DYNAMIC_TOOLS = JSON.parse(process.env.OC_DYNAMIC_TOOLS ?? "[]") as Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}>;

const server = new McpServer({
  name: "openconclave-dynamic-tools",
  version: "0.1.0",
});

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string;
  const enumValues = schema.enum as string[] | undefined;

  if (enumValues && enumValues.length > 0) {
    return z.enum(enumValues as [string, ...string[]]);
  }

  switch (type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required ?? []) as string[];
      const shape: Record<string, z.ZodType> = {};
      for (const [key, propSchema] of Object.entries(props)) {
        const zodProp = jsonSchemaToZod(propSchema);
        shape[key] = required.includes(key) ? zodProp : zodProp.optional();
      }
      return z.object(shape);
    }
    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      return z.array(items ? jsonSchemaToZod(items) : z.unknown());
    }
    default:
      return z.unknown();
  }
}

for (const toolDef of DYNAMIC_TOOLS) {
  const props = (toolDef.input_schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (toolDef.input_schema.required ?? []) as string[];

  const shape: Record<string, z.ZodType> = {};
  for (const [key, propSchema] of Object.entries(props)) {
    let zodProp = jsonSchemaToZod(propSchema);
    const desc = propSchema.description as string | undefined;
    if (desc && zodProp instanceof z.ZodString) {
      zodProp = (zodProp as z.ZodString).describe(desc);
    }
    shape[key] = required.includes(key) ? zodProp : zodProp.optional();
  }

  server.tool(
    toolDef.name,
    toolDef.description,
    shape,
    async (args: Record<string, unknown>) => {
      if (STATE_FILE) {
        writeFileSync(STATE_FILE, JSON.stringify({ tool_name: toolDef.name, tool_input: args }));
      }
      return {
        content: [{ type: "text" as const, text: `Action recorded: ${toolDef.name}` }],
      };
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
