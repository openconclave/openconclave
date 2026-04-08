/**
 * Workspace — single source of truth for working directory resolution.
 *
 * Created once per workflow run from trigger config / payload.
 * Passed through to every node executor, agent runtime, and tool.
 *
 * Centralizes:
 *  - CWD resolution (from trigger payload / config / fallback)
 *  - Path resolution (relative → absolute)
 *  - Allowed directories (for MCP filesystem server)
 *  - MCP server configs (single source, no duplication)
 */

import { join, isAbsolute, resolve, normalize } from "path";

// ── MCP server configs ──────────────────────────────────────

interface McpServerConfig {
  command: string;
  args: string[];
}

const MCP_SERVER_CONFIGS: Record<string, McpServerConfig> = {
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

// ── Workspace ───────────────────────────────────────────────

/** Default CWD: where the server process was started. */
const SERVER_CWD = process.cwd();

export class Workspace {
  /** The resolved working directory (absolute, normalized path). */
  readonly cwd: string;

  /** Extra directories the workflow has been granted access to. */
  private extraAllowedDirs: string[] = [];

  constructor(cwd?: string) {
    this.cwd = cwd ? normalize(resolve(cwd)) : SERVER_CWD;
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
   * Set additional directories the workflow is allowed to access.
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
   * Get MCP server launch configs for the given server IDs.
   * Automatically injects allowed directories into the filesystem server args.
   */
  getMcpServerConfigs(serverIds: string[]): Record<string, { command: string; args: string[] }> {
    const result: Record<string, { command: string; args: string[] }> = {};

    for (const id of serverIds) {
      const config = MCP_SERVER_CONFIGS[id];
      if (!config) continue;

      const args = [...config.args];
      if (id === "filesystem") {
        args.push(...this.getAllowedDirs());
      }

      result[id] = { command: config.command, args };
    }

    return result;
  }

  /** Look up a single MCP server base config (without filesystem dirs injected). */
  static getMcpServerBaseConfig(serverId: string): McpServerConfig | undefined {
    return MCP_SERVER_CONFIGS[serverId];
  }

  /** All known MCP server IDs. */
  static get knownMcpServerIds(): string[] {
    return Object.keys(MCP_SERVER_CONFIGS);
  }
}
