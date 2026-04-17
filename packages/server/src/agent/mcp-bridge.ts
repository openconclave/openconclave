import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { VERSION } from "@openconclave/shared";
import { Workspace, type McpResolvedConfig } from "../engine/workspace";

/** Sanitize a server ID for use in tool name prefixes (OpenAI requires ^[a-zA-Z0-9_-]+$). */
function sanitizePrefix(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Recursively fix JSON Schema constructs that OpenAI doesn't support (e.g. tuple items). */
function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const s = { ...(schema as Record<string, unknown>) };

  // OpenAI requires items to be object|boolean, not array (tuple validation)
  if (Array.isArray(s.items)) {
    s.items = s.items[0] ?? {};
  }

  // Recurse into properties
  if (s.properties && typeof s.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
      props[k] = sanitizeSchema(v);
    }
    s.properties = props;
  }

  // Recurse into items if it's an object
  if (s.items && typeof s.items === "object" && !Array.isArray(s.items)) {
    s.items = sanitizeSchema(s.items);
  }

  return s;
}

export interface ConnectResult {
  serverId: string;
  ok: boolean;
  error?: string;
}

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
  private transports = new Map<string, StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport>();
  private toolMap = new Map<string, { serverId: string; toolName: string }>();
  private ollamaTools: OllamaTool[] = [];

  /**
   * Connect to MCP servers using resolved configs.
   * Supports stdio, streamable-http, and sse transports.
   *
   * Returns per-server results so callers can log partial failures — previously
   * a misconfigured server would be swallowed at console.error and the agent
   * would run with a silently-reduced tool surface.
   */
  async connectResolved(configs: Record<string, McpResolvedConfig>): Promise<ConnectResult[]> {
    const results: ConnectResult[] = [];
    for (const [id, config] of Object.entries(configs)) {
      try {
        let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

        if (config.transport === "stdio") {
          transport = new StdioClientTransport({
            command: config.command!,
            args: config.args ?? [],
            env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
          });
        } else if (config.transport === "streamable-http") {
          transport = new StreamableHTTPClientTransport(new URL(config.url!));
        } else {
          transport = new SSEClientTransport(new URL(config.url!));
        }

        const client = new Client(
          { name: "openconclave", version: VERSION },
          { capabilities: {} }
        );

        await client.connect(transport);

        const toolsResult = await client.listTools();

        for (const tool of toolsResult.tools) {
          const prefixedName = `${sanitizePrefix(id)}__${tool.name}`;
          this.toolMap.set(prefixedName, { serverId: id, toolName: tool.name });

          this.ollamaTools.push({
            type: "function",
            function: {
              name: prefixedName,
              description: tool.description ?? "",
              parameters: sanitizeSchema(tool.inputSchema),
            },
          });
        }

        this.clients.set(id, client);
        this.transports.set(id, transport);
        results.push({ serverId: id, ok: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ serverId: id, ok: false, error: message });
      }
    }
    return results;
  }

  /**
   * Legacy connect path: resolve server IDs via Workspace hardcoded configs.
   * Used by code that still passes string[] server IDs.
   */
  async connect(serverIds: string[], allowedDirs?: string[]): Promise<void> {
    const ws = new Workspace();
    if (allowedDirs?.length) {
      ws.setAllowedDirs(allowedDirs);
    }
    const serverConfigs = ws.getMcpServerConfigs(serverIds);

    const resolved: Record<string, McpResolvedConfig> = {};
    for (const [id, config] of Object.entries(serverConfigs)) {
      resolved[id] = { transport: "stdio", command: config.command, args: config.args };
    }

    await this.connectResolved(resolved);
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
    for (const [, client] of this.clients) {
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
