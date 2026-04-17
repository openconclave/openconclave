import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import type { Workspace } from "../../engine/workspace";
import { buildSubprocessEnv } from "../subprocess-env";
import { logger } from "../../lib/logger";

// OC owns the in-process "oc" and "openconclave-conclave" MCP server IDs —
// reject user configs that try to reuse these or they'd silently clobber the
// mcp__oc__* and mcp__openconclave-conclave__* tool surfaces.
const RESERVED_MCP_IDS = new Set(["oc", "openconclave-conclave"]);

export function buildExternalMcpServers(
  config: ResolvedAgentConfig,
  ws: Workspace,
  runId: number | undefined,
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  if (!config.mcpServers?.length) return out;

  const mcpTools = config.mcpTools ?? [];
  const legacyIds = config.mcpServers.filter(
    (id) => !mcpTools.some((t) => t.toolId === id),
  );
  const resolved = ws.getMcpToolConfigs(mcpTools, legacyIds);

  for (const [id, cfg] of Object.entries(resolved)) {
    if (RESERVED_MCP_IDS.has(id)) {
      logger.error("MCP server id is reserved for OC internals; ignoring", {
        serverId: id,
        runId,
      });
      continue;
    }
    if (cfg.transport === "stdio" && cfg.command) {
      // Route env through the shared denylist so stdio MCP subprocesses
      // don't inherit ANTHROPIC_API_KEY / DATABASE_URL / session secrets.
      // User-configured cfg.env layers on top so intentional MCP creds
      // (GITHUB_TOKEN, NOTION_API_KEY, etc.) aren't blanked by the regex.
      out[id] = {
        type: "stdio",
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...buildSubprocessEnv(), ...(cfg.env ?? {}) },
      };
    } else if (cfg.transport === "sse" && cfg.url) {
      out[id] = { type: "sse", url: cfg.url };
    } else if (cfg.transport === "streamable-http" && cfg.url) {
      out[id] = { type: "http", url: cfg.url };
    }
  }
  return out;
}
