/**
 * Workspace — single source of truth for working directory resolution.
 *
 * Created once per conclave run from trigger config / payload.
 * Passed through to every node executor, agent runtime, and tool.
 *
 * Centralizes:
 *  - CWD resolution (from trigger payload / config / fallback)
 *  - Path resolution (relative → absolute)
 *  - Allowed directories (for MCP filesystem server)
 *  - MCP server configs (single source, no duplication)
 */

import { join, isAbsolute, resolve, normalize } from "path";
import type { ToolConfig } from "@openconclave/shared";

// ── MCP server configs ──────────────────────────────────────

interface McpServerConfig {
  command: string;
  args: string[];
}

/** Legacy hardcoded servers — used as fallback for old conclaves. */
const LEGACY_MCP_SERVER_CONFIGS: Record<string, McpServerConfig> = {
  playwright: {
    command: "npx",
    args: ["@playwright/mcp@latest"],
  },
  "telegram-voice": {
    command: "npx",
    args: ["@anthropic-ai/mcp-server-telegram-voice@latest"],
  },
  filesystem: {
    command: "npx",
    args: ["@modelcontextprotocol/server-filesystem@latest"],
  },
  fetch: {
    command: "npx",
    args: ["@modelcontextprotocol/server-fetch@latest"],
  },
};

/** Resolved config for launching an MCP server (stdio or remote). */
export interface McpResolvedConfig {
  transport: "stdio" | "streamable-http" | "sse";
  /** For stdio transport */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** For remote transports */
  url?: string;
}

// ── Workspace ───────────────────────────────────────────────

/** Default CWD: where the server process was started. */
const SERVER_CWD = process.cwd();

export class Workspace {
  /** The resolved working directory (absolute, normalized path). */
  cwd: string;

  /** Extra directories the conclave has been granted access to. */
  private extraAllowedDirs: string[] = [];

  constructor(cwd?: string) {
    this.cwd = cwd ? normalize(resolve(cwd)) : SERVER_CWD;
  }

  /** Update the working directory (e.g. from a code node creating a worktree). */
  setCwd(newCwd: string): void {
    this.cwd = normalize(resolve(newCwd));
  }

  /**
   * Create a Workspace from trigger payload and/or trigger node config.
   *
   * Extracts `_callerCwd` from payload (set by channel plugin), falls back
   * to the trigger node's `workingDirectory` config, then to `process.cwd()`.
   *
   * Returns both the workspace and the cleaned payload (with `_callerCwd` stripped).
   */
  static fromTrigger(
    triggerPayload?: unknown,
    triggerWorkingDirectory?: string,
  ): { workspace: Workspace; cleanPayload: unknown } {
    let cwd: string | undefined;
    let cleanPayload = triggerPayload;

    // Extract _callerCwd from payload
    if (
      triggerPayload &&
      typeof triggerPayload === "object" &&
      "_callerCwd" in (triggerPayload as Record<string, unknown>)
    ) {
      const { _callerCwd, ...rest } = triggerPayload as Record<string, unknown>;
      cwd = _callerCwd as string;
      cleanPayload = Object.keys(rest).length > 0 ? rest : undefined;
    }

    // Fall back to trigger node config
    if (!cwd && triggerWorkingDirectory) {
      cwd = triggerWorkingDirectory;
    }

    return { workspace: new Workspace(cwd), cleanPayload };
  }

  // ── Path resolution ─────────────────────────────────────────

  /** Resolve a path relative to the workspace. Absolute paths pass through normalized. */
  resolve(path: string): string {
    if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) return normalize(path);
    return normalize(join(this.cwd, path));
  }

  // ── Allowed directories ─────────────────────────────────────

  /**
   * Set additional directories the conclave is allowed to access.
   * These are added on top of the default cwd + parent.
   */
  setAllowedDirs(dirs: string[]): void {
    this.extraAllowedDirs = dirs.map((d) => normalize(resolve(d)));
  }

  /**
   * All directories that tools (MCP filesystem, builtin tools) should have access to.
   * Only includes cwd by default. Extra dirs must be added explicitly via setAllowedDirs().
   */
  getAllowedDirs(): string[] {
    return [this.cwd, ...this.extraAllowedDirs];
  }

  // ── MCP server configs ──────────────────────────────────────

  /**
   * Get MCP server launch configs for the given server IDs (legacy path).
   * Automatically injects allowed directories into the filesystem server args.
   */
  getMcpServerConfigs(serverIds: string[]): Record<string, { command: string; args: string[] }> {
    const result: Record<string, { command: string; args: string[] }> = {};

    for (const id of serverIds) {
      const config = LEGACY_MCP_SERVER_CONFIGS[id];
      if (!config) continue;

      const args = [...config.args];
      if (id === "filesystem") {
        args.push(...this.getAllowedDirs());
      }

      result[id] = { command: config.command, args };
    }

    return result;
  }

  /**
   * Resolve MCP server configs from full ToolConfig objects (registry path)
   * and legacy string IDs (backward compat).
   *
   * Returns a map of serverId → McpResolvedConfig ready for McpBridge.
   */
  getMcpToolConfigs(
    mcpTools: ToolConfig[],
    legacyIds: string[] = [],
  ): Record<string, McpResolvedConfig> {
    const result: Record<string, McpResolvedConfig> = {};

    // Registry-sourced tools
    for (const tool of mcpTools) {
      const lc = tool.mcpLaunchConfig;
      if (!lc) {
        // No launch config — fall through to legacy lookup
        const legacy = LEGACY_MCP_SERVER_CONFIGS[tool.toolId];
        if (legacy) {
          const args = [...legacy.args];
          if (tool.toolId === "filesystem") args.push(...this.getAllowedDirs());
          result[tool.toolId] = { transport: "stdio", command: legacy.command, args };
        }
        continue;
      }

      // Prefer stdio package if available
      if (lc.package) {
        const pkg = lc.package;
        const runtime = pkg.runtimeHint ?? (pkg.registryType === "npm" ? "npx" : "uvx");
        const pkgRef = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
        const args = [pkgRef];

        // Append user-provided named arguments
        if (lc.argValues) {
          for (const [name, value] of Object.entries(lc.argValues)) {
            args.push(`--${name}`, value);
          }
        }

        // Build env from user-provided values
        const env: Record<string, string> = {};
        if (lc.envValues) {
          Object.assign(env, lc.envValues);
        }

        result[tool.toolId] = {
          transport: "stdio",
          command: runtime,
          args,
          env: Object.keys(env).length > 0 ? env : undefined,
        };
      } else if (lc.remote) {
        result[tool.toolId] = {
          transport: lc.remote.type,
          url: lc.remote.url,
        };
      }
    }

    // Legacy string IDs not already covered
    for (const id of legacyIds) {
      if (result[id]) continue;
      const legacy = LEGACY_MCP_SERVER_CONFIGS[id];
      if (!legacy) continue;
      const args = [...legacy.args];
      if (id === "filesystem") args.push(...this.getAllowedDirs());
      result[id] = { transport: "stdio", command: legacy.command, args };
    }

    return result;
  }

  /** Look up a single legacy MCP server base config. */
  static getMcpServerBaseConfig(serverId: string): McpServerConfig | undefined {
    return LEGACY_MCP_SERVER_CONFIGS[serverId];
  }

  /** All known legacy MCP server IDs. */
  static get knownMcpServerIds(): string[] {
    return Object.keys(LEGACY_MCP_SERVER_CONFIGS);
  }
}
