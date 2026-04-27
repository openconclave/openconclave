import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { VERSION } from "@openconclave/shared";
import type { McpResolvedConfig } from "../engine/workspace";
import { buildSubprocessEnv } from "./subprocess-env";
import { logger } from "../lib/logger";

const MCP_CALL_TIMEOUT_MS = 60_000;
const MCP_CONNECT_TIMEOUT_MS = 30_000;
const MCP_CLOSE_TIMEOUT_MS = 5_000;
const OPENAI_TOOL_NAME_MAX = 64;

/** Run `promise` with a wall-clock timeout. Rejects with a clear error on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Coerce any string to OpenAI's function-name alphabet (^[a-zA-Z0-9_-]+$). */
function sanitizeForToolName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Deterministic 32-bit hash for tool-name disambiguation on length overflow. */
function cheapHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Build a `${prefix}__${name}` tool identifier that fits OpenAI's 64-char cap.
 * If the natural concatenation overflows, append a hash suffix so distinct
 * originals don't silently alias. Trims prefix too — a 53+ char server id
 * would otherwise leave no room for the tool name plus hash.
 */
function fitToolName(prefix: string, name: string): string {
  const direct = `${prefix}__${name}`;
  if (direct.length <= OPENAI_TOOL_NAME_MAX) return direct;
  const hash = cheapHash(direct).toString(36);
  const suffix = `_${hash}`;
  const sepLen = 2;
  const budget = OPENAI_TOOL_NAME_MAX - suffix.length - sepLen;
  const prefixBudget = Math.max(1, Math.min(prefix.length, Math.floor(budget / 2)));
  const nameBudget = Math.max(1, budget - prefixBudget);
  return `${prefix.slice(0, prefixBudget)}__${name.slice(0, nameBudget)}${suffix}`;
}

/** Same contract as `fitToolName` but with a trailing `_<n>` disambiguator. */
function fitWithSuffix(base: string, n: number): string {
  const suffix = `_${n}`;
  if (base.length + suffix.length <= OPENAI_TOOL_NAME_MAX) return base + suffix;
  return base.slice(0, OPENAI_TOOL_NAME_MAX - suffix.length) + suffix;
}

const SANITIZE_SCHEMA_MAX_DEPTH = 32;

/**
 * Fix JSON Schema constructs OpenAI's strict-mode validator rejects (tuple
 * items, etc.). Walks all subschema containers — `properties`, `items`,
 * `oneOf`/`anyOf`/`allOf`, `additionalProperties` when object, `patternProperties`,
 * `not`, and the 2020-12 `prefixItems` — so a malformed construct buried in
 * a `oneOf[1].items` can't slip past. Bounds recursion depth so a hostile or
 * self-referential schema from an external MCP server can't stack-overflow
 * the server.
 */
function sanitizeSchema(schema: unknown, depth = 0): Record<string, unknown> {
  if (depth > SANITIZE_SCHEMA_MAX_DEPTH) return { type: "object", properties: {}, additionalProperties: false };
  if (!schema || typeof schema !== "object") return { type: "object", properties: {}, additionalProperties: false };
  const s = { ...(schema as Record<string, unknown>) };

  // OpenAI requires items to be object|boolean, not array (tuple validation).
  if (Array.isArray(s.items)) {
    s.items = s.items[0] ?? {};
  }
  if (s.items && typeof s.items === "object" && !Array.isArray(s.items)) {
    s.items = sanitizeSchema(s.items, depth + 1);
  }

  // Collapse tuple-style prefixItems to the first element's type. Only overwrite
  // items if one isn't already present — the 2020-12 "rest" schema in `items`
  // is more useful than a single tuple position.
  if (Array.isArray(s.prefixItems)) {
    if (!s.items) s.items = sanitizeSchema(s.prefixItems[0] ?? {}, depth + 1);
    delete s.prefixItems;
  }

  if (s.properties && typeof s.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
      props[k] = sanitizeSchema(v, depth + 1);
    }
    s.properties = props;
  }

  if (s.patternProperties && typeof s.patternProperties === "object") {
    const pp: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.patternProperties as Record<string, unknown>)) {
      pp[k] = sanitizeSchema(v, depth + 1);
    }
    s.patternProperties = pp;
  }

  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    s.additionalProperties = sanitizeSchema(s.additionalProperties, depth + 1);
  }

  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    if (Array.isArray(s[key])) {
      s[key] = (s[key] as unknown[]).map((v) => sanitizeSchema(v, depth + 1));
    }
  }

  if (s.not && typeof s.not === "object") {
    s.not = sanitizeSchema(s.not, depth + 1);
  }

  return s;
}

export interface ConnectResult {
  serverId: string;
  ok: boolean;
  error?: string;
  /** Distinguishes graceful cancellation from a real failure so callers can
   *  choose the right log level. */
  reason?: "cancelled" | "error";
}

type BridgedTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * Bridge between OpenConclave agents and MCP servers.
 *
 * Not re-entrant while a connect is in flight: call disconnect() to reset
 * state before reconnecting on the same instance.
 */
export class McpBridge {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport>();
  private toolMap = new Map<string, { serverId: string; toolName: string }>();
  private bridgedTools: BridgedTool[] = [];
  private connected = false;
  private disconnectRequested = false;

  /**
   * Connect to MCP servers using resolved configs.
   * Supports stdio, streamable-http, and sse transports.
   *
   * Returns per-server results so partial failures don’t take down the whole connect.
   */
  async connectResolved(configs: Record<string, McpResolvedConfig>): Promise<ConnectResult[]> {
    if (this.connected) {
      throw new Error("McpBridge.connectResolved already ran on this instance; call disconnect() first or construct a new bridge");
    }
    this.connected = true;
    this.disconnectRequested = false;

    const results: ConnectResult[] = [];
    const claimedToolNames = new Set<string>();

    for (const [id, config] of Object.entries(configs)) {
      if (this.disconnectRequested) break;

      if (config.transport === "stdio" && !config.command) {
        results.push({ serverId: id, ok: false, error: "stdio transport missing command" });
        continue;
      }
      if ((config.transport === "streamable-http" || config.transport === "sse") && !config.url) {
        results.push({ serverId: id, ok: false, error: `${config.transport} transport missing url` });
        continue;
      }

      let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | undefined;
      let client: Client | undefined;
      try {
        if (config.transport === "stdio") {
          // Denylist-filter process.env, THEN layer config.env on top so that
          // user-supplied MCP credentials (NOTION_API_KEY, GITHUB_TOKEN, etc.)
          // aren't blanked by the secret-name regex — those are intentional,
          // not accidental leaks.
          const env = { ...buildSubprocessEnv(), ...(config.env ?? {}) };
          transport = new StdioClientTransport({
            command: config.command as string,
            args: config.args ?? [],
            env,
          });
        } else if (config.transport === "streamable-http") {
          transport = new StreamableHTTPClientTransport(new URL(config.url as string));
        } else if (config.transport === "sse") {
          transport = new SSEClientTransport(new URL(config.url as string));
        } else {
          throw new Error(`Unknown transport: ${String(config.transport)}`);
        }

        client = new Client(
          { name: "openconclave", version: VERSION },
          { capabilities: {} }
        );

        await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `MCP ${id} connect`);
        const toolsResult = await withTimeout(client.listTools(), MCP_CONNECT_TIMEOUT_MS, `MCP ${id} listTools`);

        if (this.disconnectRequested) {
          try { await client.close(); } catch { /* already dead */ }
          try { await transport.close(); } catch { /* already dead */ }
          results.push({ serverId: id, ok: false, error: "disconnected during connect", reason: "cancelled" });
          break;
        }

        // Stage this server's registrations locally. Only merge into the
        // bridge's public state after the final gate passes — otherwise a
        // disconnect that races the sync loop below can clear bridge state,
        // then we'd repopulate toolMap/bridgedTools with orphaned entries.
        const pendingToolMap: Array<[string, { serverId: string; toolName: string }]> = [];
        const pendingBridged: BridgedTool[] = [];
        const prefix = sanitizeForToolName(id);
        for (const tool of toolsResult.tools) {
          const rawName = sanitizeForToolName(tool.name);
          let prefixedName = fitToolName(prefix, rawName);
          if (claimedToolNames.has(prefixedName)) {
            // Collision after sanitization (e.g. `my.server` and `my_server`
            // both → `my_server`). Disambiguate with a numeric suffix.
            let n = 2;
            while (claimedToolNames.has(fitWithSuffix(prefixedName, n))) n++;
            prefixedName = fitWithSuffix(prefixedName, n);
          }
          claimedToolNames.add(prefixedName);
          pendingToolMap.push([prefixedName, { serverId: id, toolName: tool.name }]);
          pendingBridged.push({
            type: "function",
            function: {
              name: prefixedName,
              description: tool.description ?? "",
              parameters: sanitizeSchema(tool.inputSchema),
            },
          });
        }

        // Atomic merge: maps + array are all set inside the same sync tick,
        // so no external caller can observe half-registered state.
        for (const [name, mapping] of pendingToolMap) this.toolMap.set(name, mapping);
        for (const t of pendingBridged) this.bridgedTools.push(t);
        this.clients.set(id, client);
        this.transports.set(id, transport);
        results.push({ serverId: id, ok: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Tear down BOTH client and transport. SDK cascade isn't a documented
        // contract, and if client.close succeeded the transport could still
        // own a live subprocess / socket.
        if (client) {
          try { await client.close(); } catch (e: unknown) {
            logger.warn("MCP cleanup: client.close failed", {
              serverId: id, phase: "connect-failure",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (transport) {
          try { await transport.close(); } catch (e: unknown) {
            logger.warn("MCP cleanup: transport.close failed", {
              serverId: id, phase: "connect-failure",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        results.push({ serverId: id, ok: false, error: message, reason: "error" });
      }
    }
    return results;
  }

  getTools(): BridgedTool[] {
    // Shallow copy so callers can't mutate bridge state through the array.
    return this.bridgedTools.slice();
  }

  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<string> {
    const mapping = this.toolMap.get(prefixedName);
    if (!mapping) return `Error: Unknown tool "${prefixedName}"`;

    const client = this.clients.get(mapping.serverId);
    if (!client) return `Error: MCP server "${mapping.serverId}" not connected`;

    try {
      const result = await withTimeout(
        client.callTool({ name: mapping.toolName, arguments: args }),
        MCP_CALL_TIMEOUT_MS,
        `MCP tool ${mapping.toolName}`,
      );

      // Render mixed content: keep text items verbatim; replace binary items
      // (images, audio, resources) with short placeholders. Without this, a
      // screenshot-returning MCP server would DoS the context window by base64
      // round-tripping via JSON.stringify, and a mixed result would silently
      // drop everything non-text.
      const content = Array.isArray(result.content) ? result.content : [];
      const parts: string[] = [];
      for (const c of content) {
        if (c !== null && typeof c === "object") {
          const type = (c as { type?: unknown }).type;
          const text = (c as { text?: unknown }).text;
          if (type === "text" && typeof text === "string") {
            parts.push(text);
          } else {
            const mime = (c as { mimeType?: unknown }).mimeType;
            const label = typeof type === "string" ? type : "unknown";
            parts.push(
              typeof mime === "string"
                ? `[${label} content omitted: ${mime}]`
                : `[${label} content omitted]`,
            );
          }
        }
      }
      const body = parts.join("\n") || "(no content)";

      if (result.isError) {
        // If the tool already prefixed its own message with "Error:", don't
        // stack a second one.
        const trimmed = body.replace(/^Error:\s*/i, "");
        return `Error: ${trimmed}`;
      }
      return body;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error calling ${mapping.toolName}: ${message}`;
    }
  }

  hasTools(): boolean {
    return this.bridgedTools.length > 0;
  }

  async disconnect(): Promise<void> {
    this.disconnectRequested = true;

    // Parallel + per-close timeout: one wedged server shouldn't hold up the
    // others, and Promise.allSettled without timeouts would still wait on the
    // slowest. Transports are closed explicitly after client.close because
    // the SDK's cascade isn't a documented contract.
    const entries = Array.from(this.clients.entries());
    const transportEntries = Array.from(this.transports.entries());

    await Promise.allSettled(
      entries.map(async ([id, client]) => {
        try {
          await withTimeout(client.close(), MCP_CLOSE_TIMEOUT_MS, `MCP ${id} close`);
        } catch (err: unknown) {
          logger.warn("MCP client close failed", {
            serverId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
    await Promise.allSettled(
      transportEntries.map(async ([id, transport]) => {
        try {
          await withTimeout(transport.close(), MCP_CLOSE_TIMEOUT_MS, `MCP ${id} transport close`);
        } catch { /* best-effort */ }
      }),
    );

    this.clients.clear();
    this.transports.clear();
    this.toolMap.clear();
    this.bridgedTools = [];
    this.connected = false;
  }
}
