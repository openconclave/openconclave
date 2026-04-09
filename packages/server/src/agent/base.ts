/**
 * AgentBase — unified tool resolution for all agent engines.
 *
 * Connected tool nodes on the canvas resolve to ResolvedAgentConfig.
 * This class converts those config fields into concrete tool definitions
 * and executors that any engine (Claude, Ollama, OpenAI) can consume.
 */

import type { ResolvedAgentConfig } from "@openconclave/shared";
import { createBuiltinTools, TOOL_NAME_MAP, type BuiltinTool, type ToolDef } from "./builtin-tools";
import { McpBridge } from "./mcp-bridge";
import { logger } from "../lib/logger";
import { Workspace } from "../engine/workspace";

// ── Resolved tool (engine-agnostic) ─────────────────────────

export interface ResolvedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

// ── AgentBase ────────────────────────────────────────────────

export class AgentBase {
  readonly tools: ResolvedTool[] = [];
  readonly toolExecutors = new Map<string, (args: Record<string, unknown>) => Promise<string>>();
  private mcpBridge: McpBridge | null = null;
  protected readonly workspace: Workspace;

  constructor(
    protected readonly config: ResolvedAgentConfig,
    workspace?: Workspace,
  ) {
    this.workspace = workspace ?? new Workspace();
    this.resolveBuiltinTools();
    this.resolveKnowledgeTools();
  }

  // ── Builtin tools from connected tool nodes ─────────────────

  private resolveBuiltinTools(): void {
    const builtins = createBuiltinTools(this.workspace);

    for (const toolName of this.config.allowedTools) {
      // Map Claude Code names (Bash→bash, Read→read_file) or use direct name
      const mapped = TOOL_NAME_MAP[toolName] ?? toolName;
      const bt = builtins[mapped];
      if (bt) {
        this.addBuiltin(bt);
      }
    }
  }

  // ── Knowledge tools (when KB tool nodes are connected) ──────

  private resolveKnowledgeTools(): void {
    if (this.config.knowledgeBases.length === 0) return;

    const builtins = createBuiltinTools(this.workspace);
    const kbIds = this.config.knowledgeBases;
    const knowledgeToolNames = ["search_knowledge", "knowledge_fetch", "knowledge_add"];

    for (const name of knowledgeToolNames) {
      const bt = builtins[name];
      if (!bt) continue;

      // Patch search_knowledge: scope to agent's connected KBs only
      if (name === "search_knowledge") {
        const patchedTool = JSON.parse(JSON.stringify(bt.tool));
        const param = patchedTool.function?.parameters?.properties?.knowledge_base_id;
        if (param) {
          param.description = `Knowledge base ID to search. Available IDs: ${kbIds.join(", ")}. If omitted, searches all connected knowledge bases.`;
        }
        // Wrap execute to scope the fallback to connected KBs only
        const scopedExecute = async (args: Record<string, unknown>) => {
          if (args.knowledge_base_id === undefined) {
            args.knowledge_base_id = undefined; // keep explicit
          }
          // If no ID provided, inject connected KB IDs via searchMultipleKBs
          if (args.knowledge_base_id === undefined && kbIds.length > 0) {
            const { searchMultipleKBs } = await import("../knowledge/search");
            const numericIds = kbIds.map(Number).filter((n) => !isNaN(n));
            const results = await searchMultipleKBs(numericIds, args.query as string, (args.top_k as number | undefined) ?? 5);
            if (results.length === 0) return "No relevant results found.";
            return results
              .map((r: { score: number; knowledgeBaseId: number; documentId: number; chunkIndex: number; documentName: string; content: string }, i: number) =>
                `[${i + 1}] (score: ${r.score.toFixed(3)}) [kb:${r.knowledgeBaseId} doc:${r.documentId} chunk:${r.chunkIndex}] ${r.documentName}\n${r.content}`)
              .join("\n\n---\n\n");
          }
          return bt.execute(args);
        };
        this.addBuiltin({ tool: patchedTool, execute: scopedExecute });
      } else {
        this.addBuiltin(bt);
      }
    }
  }

  // ── MCP server tools (from connected MCP tool nodes) ────────

  async connectMcpServers(): Promise<void> {
    if (this.config.mcpServers.length === 0) return;

    this.mcpBridge = new McpBridge();
    try {
      // Use new registry-aware path if mcpTools are available
      const mcpTools = this.config.mcpTools ?? [];
      const legacyIds = this.config.mcpServers.filter(
        (id) => !mcpTools.some((t) => t.toolId === id),
      );
      const configs = this.workspace.getMcpToolConfigs(mcpTools, legacyIds);

      if (Object.keys(configs).length > 0) {
        await this.mcpBridge.connectResolved(configs);
      }

      for (const tool of this.mcpBridge.getTools()) {
        const name = tool.function.name;
        this.tools.push({
          name,
          description: tool.function.description,
          parameters: tool.function.parameters as Record<string, unknown>,
          execute: async (args) => this.mcpBridge!.callTool(name, args),
        });
        this.toolExecutors.set(name, async (args) => this.mcpBridge!.callTool(name, args));
      }
    } catch (err: unknown) {
      logger.warn("Failed to connect MCP servers", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.mcpBridge) {
      await this.mcpBridge.disconnect();
      this.mcpBridge = null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private addBuiltin(bt: BuiltinTool): void {
    const name = bt.tool.function.name;
    // Avoid duplicates
    if (this.toolExecutors.has(name)) return;
    this.tools.push({
      name,
      description: bt.tool.function.description,
      parameters: bt.tool.function.parameters,
      execute: bt.execute,
    });
    this.toolExecutors.set(name, bt.execute);
  }

  /** Get tools in OpenAI Chat Completions format (nested under `function`) */
  toChatTools(): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  /** Get tools in OpenAI Responses API format (top-level name/description) */
  toResponsesTools(): Array<{ type: "function"; name: string; description: string; parameters: Record<string, unknown> }> {
    return this.tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /** Get tool IDs for Ollama (used to filter from OllamaBuiltinTools) */
  getToolIds(): string[] {
    return this.tools.map((t) => t.name);
  }
}
