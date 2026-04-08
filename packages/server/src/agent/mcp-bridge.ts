import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "bun";
import { Workspace } from "../engine/workspace";

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export class McpBridge {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport>();
  private toolMap = new Map<string, { serverId: string; toolName: string }>();
  private ollamaTools: OllamaTool[] = [];

  async connect(serverIds: string[], allowedDirs?: string[]): Promise<void> {
    // Build server configs using Workspace (single source of truth for MCP server definitions).
    // If allowedDirs are provided, create a temp workspace with those dirs for filesystem server.
    const ws = new Workspace();
    if (allowedDirs?.length) {
      ws.setAllowedDirs(allowedDirs);
    }
    const serverConfigs = ws.getMcpServerConfigs(serverIds);

    for (const id of serverIds) {
      const config = serverConfigs[id];
      if (!config) continue;

      try {
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
        });

        const client = new Client(
          { name: "openconclave-ollama", version: "0.1.0" },
          { capabilities: {} }
        );

        await client.connect(transport);

        // Discover tools
        const toolsResult = await client.listTools();

        for (const tool of toolsResult.tools) {
          // Prefix tool name with server ID to avoid conflicts
          const prefixedName = `${id}__${tool.name}`;
          this.toolMap.set(prefixedName, { serverId: id, toolName: tool.name });

          this.ollamaTools.push({
            type: "function",
            function: {
              name: prefixedName,
              description: tool.description ?? "",
              parameters: tool.inputSchema as Record<string, unknown>,
            },
          });
        }

        this.clients.set(id, client);
        this.transports.set(id, transport);
      } catch (err: any) {
        console.error(`Failed to connect MCP server "${id}":`, err.message);
      }
    }
  }

  getTools(): OllamaTool[] {
    return this.ollamaTools;
  }

  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<string> {
    const mapping = this.toolMap.get(prefixedName);
    if (!mapping) return `Error: Unknown tool "${prefixedName}"`;

    const client = this.clients.get(mapping.serverId);
    if (!client) return `Error: MCP server "${mapping.serverId}" not connected`;

    try {
      const result = await client.callTool({
        name: mapping.toolName,
        arguments: args,
      });

      // Extract text from result content
      const texts = (result.content as any[])
        .filter((c) => c.type === "text")
        .map((c) => c.text);

      return texts.join("\n") || JSON.stringify(result.content);
    } catch (err: any) {
      return `Error calling ${mapping.toolName}: ${err.message}`;
    }
  }

  hasTools(): boolean {
    return this.ollamaTools.length > 0;
  }

  async disconnect(): Promise<void> {
    for (const [id, client] of this.clients) {
      try {
        await client.close();
      } catch {}
    }
    this.clients.clear();
    this.transports.clear();
    this.toolMap.clear();
    this.ollamaTools = [];
  }
}
