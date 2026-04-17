/**
 * AgentBase — unified tool resolution for all agent engines.
 *
 * Connected tool nodes on the canvas resolve to ResolvedAgentConfig.
 * This class converts those config fields into concrete tool definitions
 * and executors that any engine (Claude, Ollama, OpenAI) can consume.
 */

import type { ResolvedAgentConfig } from "@openconclave/shared";
import { createBuiltinTools, TOOL_NAME_MAP, type BuiltinTool } from "./builtin-tools";
import { createAttachmentBuiltinTools } from "./attachment-tools";
import { createArtifactBuiltinTools } from "./artifact-tools";
import { McpBridge } from "./mcp-bridge";
import { logger } from "../lib/logger";
import { Workspace } from "../engine/workspace";

// ── Resolved tool (engine-agnostic) ─────────────────────────

const KNOWLEDGE_TOOL_NAMES = new Set(["search_knowledge", "knowledge_fetch", "knowledge_add"]);

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
  private mcpConnectInFlight = false;
  // A unique token per connect attempt. disconnect() clears it; an in-flight
  // connect checks that its own token still matches before publishing the
  // bridge. This is cleaner than a boolean "disconnectRequested" flag, which
  // couldn't distinguish "external disconnect arrived before our entry" from
  // "...arrived during our await" without losing a signal.
  private currentConnectToken: symbol | null = null;
  private readonly mcpToolNames = new Set<string>();
  protected readonly workspace: Workspace;

  private readonly runId?: number;

  constructor(
    protected readonly config: ResolvedAgentConfig,
    workspace?: Workspace,
    runId?: number,
  ) {
    this.workspace = workspace ?? new Workspace();
    this.runId = runId;
    // Build the tool catalog once so both resolveBuiltinTools and
    // resolveKnowledgeTools see the same runId-bound set (web_fetch included
    // when runId is defined; knowledge tools always).
    const builtins = createBuiltinTools(this.workspace, this.runId);
    this.resolveBuiltinTools(builtins);
    this.resolveKnowledgeTools(builtins);
    if (runId !== undefined) {
      this.resolveAttachmentTools(runId);
      this.resolveArtifactTools(runId);
    }
  }

  // ── Builtin tools from connected tool nodes ─────────────────

  private resolveBuiltinTools(builtins: Record<string, BuiltinTool>): void {
    for (const toolName of this.config.allowedTools) {
      const mapped = TOOL_NAME_MAP[toolName] ?? toolName;
      // Knowledge tools must register only via resolveKnowledgeTools, where
      // the KB-scoping wrappers live. addBuiltin is first-wins, so registering
      // the raw builtin here would shadow the scoped wrapper.
      if (KNOWLEDGE_TOOL_NAMES.has(mapped)) continue;
      const bt = builtins[mapped];
      if (bt) {
        this.addBuiltin(bt);
      } else {
        // allowedTools is specifically for builtins (MCP goes through mcpServers
        // / mcpTools), so any unresolved entry is a misconfiguration. Warn
        // regardless of casing — previously a lowercase "web_fetch" would fall
        // through silently because it didn't match the capitalized map key.
        logger.warn("allowedTool has no builtin executor", {
          toolName,
          mappedTo: mapped,
          hasRunId: this.runId !== undefined,
        });
      }
    }
  }

  // ── Knowledge tools (when KB tool nodes are connected) ──────

  private resolveKnowledgeTools(builtins: Record<string, BuiltinTool>): void {
    const kbIds = this.config.knowledgeBases;
    if (kbIds.length === 0) return;
    // KB ids are positive integers (DB autoincrement — id 0 never exists).
    // Reject non-digit strings (Number("") === 0 would authorize id 0),
    // explicit leading zero, and ids past MAX_SAFE_INTEGER (which would collapse
    // neighbors via double-precision rounding).
    const allowedNumericIds = new Set(
      kbIds
        .filter((s) => /^[1-9]\d*$/.test(s))
        .map(Number)
        .filter((n) => Number.isSafeInteger(n)),
    );
    if (allowedNumericIds.size === 0) {
      // Every configured id failed validation — registering tools would make
      // every call return "not connected" with no way for the agent to recover.
      logger.warn("knowledge tools skipped: no valid KB ids in config", {
        configured: kbIds,
        runId: this.runId,
      });
      return;
    }
    const knowledgeToolNames = ["search_knowledge", "knowledge_fetch", "knowledge_add"];

    for (const name of knowledgeToolNames) {
      const bt = builtins[name];
      if (!bt) continue;

      if (name === "search_knowledge") {
        const patchedTool = JSON.parse(JSON.stringify(bt.tool));
        const param = patchedTool.function?.parameters?.properties?.knowledge_base_id;
        if (param) {
          param.description = `Knowledge base ID to search. Available IDs: ${kbIds.join(", ")}. If omitted, searches all connected knowledge bases.`;
        }
        const scopedExecute = async (args: Record<string, unknown>) => {
          // Validate query+topK unconditionally — the fast-path (kb_id present)
          // previously skipped these, letting `top_k: 1_000_000` reach the DB.
          if (typeof args.query !== "string" || args.query.length === 0) {
            return "Error: query must be a non-empty string.";
          }
          const topK = typeof args.top_k === "number" && args.top_k > 0 ? args.top_k : 5;

          if (args.knowledge_base_id !== undefined && args.knowledge_base_id !== null) {
            const id = Number(args.knowledge_base_id);
            if (!allowedNumericIds.has(id)) {
              return `Error: knowledge_base_id ${args.knowledge_base_id} not connected to this agent. Available IDs: ${kbIds.join(", ")}.`;
            }
            return bt.execute({ ...args, knowledge_base_id: id, query: args.query, top_k: topK });
          }

          // No kb_id: fan out over the agent's connected KBs.
          try {
            const { searchMultipleKBs } = await import("../knowledge/search");
            const numericIds = [...allowedNumericIds];
            const results = await searchMultipleKBs(numericIds, args.query, topK);
            if (results.length === 0) return "No relevant results found.";
            return results
              .map((r: { score: number; knowledgeBaseId: number; documentId: number; chunkIndex: number; documentName: string; content: string }, i: number) =>
                `[${i + 1}] (score: ${r.score.toFixed(3)}) [kb:${r.knowledgeBaseId} doc:${r.documentId} chunk:${r.chunkIndex}] ${r.documentName}\n${r.content}`)
              .join("\n\n---\n\n");
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("search_knowledge scoped fallback error", { error: msg });
            return `Error searching knowledge base: ${msg}`;
          }
        };
        this.addBuiltin({ tool: patchedTool, execute: scopedExecute });
      } else {
        // knowledge_fetch and knowledge_add — reject kb_ids outside the
        // connected set so an agent bound to KB 1 can't reach KB 2.
        const patchedTool = JSON.parse(JSON.stringify(bt.tool));
        const param = patchedTool.function?.parameters?.properties?.knowledge_base_id;
        if (param) {
          param.description = `${param.description ?? "Knowledge base ID"}. Available IDs: ${kbIds.join(", ")}.`;
        }
        const scopedExecute = async (args: Record<string, unknown>) => {
          const raw = args.knowledge_base_id;
          // Reject null/undefined explicitly — Number(null) === 0 would otherwise
          // slip into allowedNumericIds.has() with id 0.
          if (raw === null || raw === undefined) {
            return `Error: knowledge_base_id is required. Available IDs: ${kbIds.join(", ")}.`;
          }
          const id = Number(raw);
          if (!allowedNumericIds.has(id)) {
            return `Error: knowledge_base_id ${raw} not connected to this agent. Available IDs: ${kbIds.join(", ")}.`;
          }
          return bt.execute({ ...args, knowledge_base_id: id });
        };
        this.addBuiltin({ tool: patchedTool, execute: scopedExecute });
      }
    }
  }

  // ── Attachment tools (auto-injected when the run has attachments) ──

  private resolveAttachmentTools(runId: number): void {
    const tools = createAttachmentBuiltinTools(runId);
    for (const bt of Object.values(tools)) this.addBuiltin(bt);
  }

  private resolveArtifactTools(runId: number): void {
    const tools = createArtifactBuiltinTools(runId);
    for (const bt of Object.values(tools)) this.addBuiltin(bt);
  }

  // ── MCP server tools (from connected MCP tool nodes) ────────

  async connectMcpServers(): Promise<void> {
    // Either path (legacy mcpServers id list OR registry-aware mcpTools entries)
    // can populate the bridge. Early-returning on just mcpServers.length === 0
    // would drop registry-only configs on the floor.
    if (this.config.mcpServers.length === 0 && (this.config.mcpTools ?? []).length === 0) return;
    if (this.mcpConnectInFlight) {
      logger.warn("connectMcpServers re-entered while a connect was in flight", {
        runId: this.runId,
      });
      return;
    }
    this.mcpConnectInFlight = true;
    const myToken = Symbol("connect");
    this.currentConnectToken = myToken;

    // Inline teardown of any prior bridge — do NOT call this.disconnect(),
    // which would null currentConnectToken and cause our own race check below
    // to abandon the new bridge.
    if (this.mcpBridge) {
      await this.mcpBridge.disconnect();
      this.mcpBridge = null;
      this.evictMcpTools();
    }

    const bridge = new McpBridge();
    try {
      const mcpTools = this.config.mcpTools ?? [];
      const legacyIds = this.config.mcpServers.filter(
        (id) => !mcpTools.some((t) => t.toolId === id),
      );
      const configs = this.workspace.getMcpToolConfigs(mcpTools, legacyIds);

      if (Object.keys(configs).length > 0) {
        const results = await bridge.connectResolved(configs);
        for (const r of results) {
          if (r.ok) continue;
          // Cancelled mid-flight is a graceful outcome, not a failure.
          if (r.reason === "cancelled") {
            logger.info("MCP server connect cancelled", {
              serverId: r.serverId,
              runId: this.runId,
            });
          } else {
            logger.error("Failed to connect MCP server", {
              serverId: r.serverId,
              error: r.error,
              runId: this.runId,
            });
          }
        }
      }

      // If our token was cleared (external disconnect) or replaced (unlikely
      // given the in-flight guard, but possible via manual token manipulation),
      // tear down the bridge we just built and bail silently.
      if (this.currentConnectToken !== myToken) {
        logger.warn("connect superseded by external disconnect; discarding new bridge", {
          runId: this.runId,
        });
        await bridge.disconnect().catch(() => { /* partial state, ignore */ });
        return;
      }

      this.mcpBridge = bridge;

      for (const tool of bridge.getTools()) {
        // Route through addBuiltin so first-wins dedupe protects KB-scoped
        // wrappers and attachment/artifact tools from a name collision.
        // `bridge` is captured in the closure so post-disconnect calls hit
        // bridge.callTool's graceful "server not connected" path.
        const name = tool.function.name;
        // Check collision BEFORE recording in mcpToolNames — otherwise a
        // rejected add would still mark the name for eviction, taking out
        // the pre-existing tool that actually owns the name.
        if (this.toolExecutors.has(name)) {
          logger.warn("MCP tool name collides with an existing tool, skipping", {
            name,
            runId: this.runId,
          });
          continue;
        }
        this.mcpToolNames.add(name);
        this.addBuiltin({
          tool: {
            type: "function",
            function: {
              name,
              description: tool.function.description,
              parameters: tool.function.parameters as Record<string, unknown>,
            },
          },
          execute: async (args) => bridge.callTool(name, args),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("MCP bridge setup failed", { error: msg, runId: this.runId });
      await bridge.disconnect().catch(() => { /* already broken */ });
      this.mcpBridge = null;
      this.evictMcpTools();
    } finally {
      this.mcpConnectInFlight = false;
    }
  }

  async disconnect(): Promise<void> {
    // Invalidate any in-flight connect so it tears down the bridge it built
    // instead of publishing it. Reset state FIRST so a failing
    // bridge.disconnect() can't leave stale tool closures registered.
    this.currentConnectToken = null;
    const bridge = this.mcpBridge;
    this.mcpBridge = null;
    this.evictMcpTools();
    if (bridge) {
      try {
        await bridge.disconnect();
      } catch (err: unknown) {
        logger.warn("MCP bridge disconnect failed", {
          error: err instanceof Error ? err.message : String(err),
          runId: this.runId,
        });
      }
    }
  }

  /** Remove MCP-registered tool entries so stale bridge closures can't be called. */
  private evictMcpTools(): void {
    if (this.mcpToolNames.size === 0) return;
    for (const name of this.mcpToolNames) {
      this.toolExecutors.delete(name);
    }
    for (let i = this.tools.length - 1; i >= 0; i--) {
      const t = this.tools[i];
      if (t && this.mcpToolNames.has(t.name)) this.tools.splice(i, 1);
    }
    this.mcpToolNames.clear();
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

  getToolIds(): string[] {
    return this.tools.map((t) => t.name);
  }
}
