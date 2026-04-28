import { Hono } from "hono";
import { logger } from "../lib/logger";
import type { McpRegistryServer, McpRegistrySearchResponse, McpServerLaunchConfig } from "@openconclave/shared";

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0.1";

const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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

setInterval(() => {
  for (const [key, entry] of cache) {
    if (Date.now() > entry.expiry) cache.delete(key);
  }
}, CACHE_TTL_MS);

function transformServer(raw: Record<string, unknown>): McpRegistryServer | null {
  const server = raw.server as Record<string, unknown> | undefined;
  if (!server) return null;

  if (typeof server.name !== "string" || !server.name) return null;
  const name = server.name;
  const description = typeof server.description === "string" ? server.description : "";
  const title = (typeof server.title === "string" ? server.title : undefined) ?? name.split("/").pop() ?? name;

  const icons = Array.isArray(server.icons) ? server.icons as Array<{ src: string }> : undefined;
  const iconUrl = icons?.[0]?.src;

  const repo = server.repository as Record<string, unknown> | undefined;
  const repositoryUrl = typeof repo?.url === "string" ? repo.url : undefined;

  const launchConfig: McpServerLaunchConfig = { registryName: name };

  const packages = Array.isArray(server.packages) ? server.packages as Array<Record<string, unknown>> : undefined;
  if (packages && packages.length > 0) {
    const stdioPkg = packages.find(
      (p) => (p.transport as Record<string, unknown>)?.type === "stdio"
    );

    if (stdioPkg) {
      launchConfig.package = {
        registryType: (stdioPkg.registryType as "npm" | "pypi" | "oci") ?? "npm",
        identifier: stdioPkg.identifier as string,
        version: typeof stdioPkg.version === "string" ? stdioPkg.version : undefined,
        runtimeHint: typeof stdioPkg.runtimeHint === "string" ? stdioPkg.runtimeHint : undefined,
        environmentVariables: Array.isArray(stdioPkg.environmentVariables)
          ? (stdioPkg.environmentVariables as Array<{ name: string; description?: string; isRequired: boolean; isSecret: boolean }>)
          : undefined,
        packageArguments: Array.isArray(stdioPkg.packageArguments)
          ? (stdioPkg.packageArguments as Array<{ name: string; description?: string; isRequired: boolean; type: "named" | "positional" }>)
          : undefined,
      };
    }
  }

  const remotes = Array.isArray(server.remotes) ? server.remotes as Array<Record<string, unknown>> : undefined;
  if (remotes && remotes.length > 0) {
    const remote = remotes[0]!;
    launchConfig.remote = {
      type: (remote.type as "streamable-http" | "sse") ?? "streamable-http",
      url: remote.url as string,
    };
  }

  if (!launchConfig.package && !launchConfig.remote) return null;

  return { name, title, description, iconUrl, repositoryUrl, launchConfig };
}

export const mcpRegistryRoutes = new Hono()
  .get("/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const raw = Number(c.req.query("limit") ?? 30);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 30;
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
      const res = await fetch(`${REGISTRY_BASE}/servers?${params}`, { signal: AbortSignal.timeout(8_000) });
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
  })
  .get("/server/:name", async (c) => {
    const name = c.req.param("name");
    const cacheKey = `server:${name}`;
    const cached = getCached<McpRegistryServer>(cacheKey);
    if (cached) return c.json(cached);

    try {
      const encoded = encodeURIComponent(name);
      const res = await fetch(`${REGISTRY_BASE}/servers/${encoded}/versions/latest`, { signal: AbortSignal.timeout(8_000) });
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
