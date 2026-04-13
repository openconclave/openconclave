import { Hono } from "hono";
import { logger } from "../lib/logger";
import type { McpRegistryServer, McpRegistrySearchResponse, McpServerLaunchConfig } from "@openconclave/shared";

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0.1";

// Simple in-memory cache (key → { data, expiry })
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// ── Transform registry response into our API shape ──────────

function transformServer(raw: Record<string, unknown>): McpRegistryServer | null {
  const server = raw.server as Record<string, unknown> | undefined;
  if (!server) return null;

  const name = server.name as string;
  const description = server.description as string ?? "";
  const title = (server.title as string) ?? name.split("/").pop() ?? name;

  // Extract first icon
  const icons = server.icons as Array<{ src: string }> | undefined;
  const iconUrl = icons?.[0]?.src;

  // Extract repo URL
  const repo = server.repository as Record<string, unknown> | undefined;
  const repositoryUrl = repo?.url as string | undefined;

  // Build launch config
  const launchConfig: McpServerLaunchConfig = { registryName: name };

  // Pick the best stdio package (prefer npm with npx hint)
  const packages = server.packages as Array<Record<string, unknown>> | undefined;
  if (packages && packages.length > 0) {
    // Prefer npm stdio packages
    const stdioPkg = packages.find(
      (p) => (p.transport as Record<string, unknown>)?.type === "stdio"
    ) ?? packages[0];

    if (stdioPkg) {
      launchConfig.package = {
        registryType: (stdioPkg.registryType as "npm" | "pypi" | "oci") ?? "npm",
        identifier: stdioPkg.identifier as string,
        version: stdioPkg.version as string | undefined,
        runtimeHint: stdioPkg.runtimeHint as string | undefined,
        environmentVariables: (stdioPkg.environmentVariables as McpServerLaunchConfig["package"] extends { environmentVariables?: infer E } ? E : never) ?? undefined,
        packageArguments: (stdioPkg.packageArguments as McpServerLaunchConfig["package"] extends { packageArguments?: infer A } ? A : never) ?? undefined,
      };
    }
  }

  // Pick the first remote endpoint
  const remotes = server.remotes as Array<Record<string, unknown>> | undefined;
  if (remotes && remotes.length > 0) {
    const remote = remotes[0]!;
    launchConfig.remote = {
      type: (remote.type as "streamable-http" | "sse") ?? "streamable-http",
      url: remote.url as string,
    };
  }

  // Skip servers that have neither package nor remote
  if (!launchConfig.package && !launchConfig.remote) return null;

  return { name, title, description, iconUrl, repositoryUrl, launchConfig };
}

// ── Routes ──────────────────────────────────────────────────

export const mcpRegistryRoutes = new Hono();

/**
 * Search the MCP Registry.
 * GET /api/mcp-registry/search?q=filesystem&limit=20&cursor=...
 */
mcpRegistryRoutes.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Math.min(Number(c.req.query("limit") ?? 30), 100);
  const cursor = c.req.query("cursor");

  const cacheKey = `search:${q}:${limit}:${cursor ?? ""}`;
  const cached = getCached<McpRegistrySearchResponse>(cacheKey);
  if (cached) return c.json(cached);

  const params = new URLSearchParams({
    version: "latest",
    limit: String(limit),
  });
  if (q) params.set("search", q);
  if (cursor) params.set("cursor", cursor);

  try {
    const res = await fetch(`${REGISTRY_BASE}/servers?${params}`);
    if (!res.ok) {
      const errText = await res.text();
      logger.error("MCP Registry search failed", { status: res.status, body: errText });
      return c.json({ error: `Registry returned ${res.status}` }, 502);
    }

    const data = (await res.json()) as {
      servers: Array<Record<string, unknown>>;
      metadata: { nextCursor?: string; count?: number };
    };

    const servers = data.servers
      .map(transformServer)
      .filter((s): s is McpRegistryServer => s !== null);

    const response: McpRegistrySearchResponse = {
      servers,
      nextCursor: data.metadata.nextCursor,
    };

    setCache(cacheKey, response);
    return c.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("MCP Registry search error", { error: message });
    return c.json({ error: `Registry unreachable: ${message}` }, 502);
  }
});

/**
 * Get a specific server's details.
 * GET /api/mcp-registry/server/:name
 * The name is URL-encoded (e.g. "io.github.foo%2Fbar").
 */
mcpRegistryRoutes.get("/server/:name", async (c) => {
  const name = c.req.param("name");
  const cacheKey = `server:${name}`;
  const cached = getCached<McpRegistryServer>(cacheKey);
  if (cached) return c.json(cached);

  try {
    const encoded = encodeURIComponent(name);
    const res = await fetch(`${REGISTRY_BASE}/servers/${encoded}/versions/latest`);
    if (!res.ok) {
      if (res.status === 404) return c.json({ error: "Server not found" }, 404);
      return c.json({ error: `Registry returned ${res.status}` }, 502);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const server = transformServer(data);
    if (!server) return c.json({ error: "Server has no usable transport" }, 404);

    setCache(cacheKey, server);
    return c.json(server);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("MCP Registry server fetch error", { error: message });
    return c.json({ error: `Registry unreachable: ${message}` }, 502);
  }
});
