import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import embeddedCliPath from "@anthropic-ai/claude-agent-sdk/embed";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, existsSync, chmodSync, renameSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import { Workspace } from "../engine/workspace";

// SDK's extractFromBunfs only checks for "$bunfs" but Bun on Windows uses "B:/~BUN/".
// Re-extract here to cover both patterns.
function resolveCliPath(path: string): string {
  if (!path.includes("$bunfs") && !path.includes("~BUN")) return path;
  try {
    const content = readFileSync(path);
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const dir = join(tmpdir(), `claude-agent-sdk-${hash}`);
    const out = join(dir, "cli.js");
    if (existsSync(out)) return out;
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `cli.js.tmp.${process.pid}`);
    writeFileSync(tmp, content);
    try { chmodSync(tmp, 0o755); } catch {}
    renameSync(tmp, out);
    return out;
  } catch {
    return path;
  }
}

const cliPath = resolveCliPath(embeddedCliPath);

export interface ThinkingBlock {
  thinking: string;
  signature?: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  costUsd?: number;
  durationMs: number;
  thinking?: ThinkingBlock[];
  routeTo?: string;
  sessionId?: string;
}

export interface RouteTarget {
  nodeId: string;
  label: string;
  type: string;
}

export type AgentRunOptions = {
  config: ResolvedAgentConfig;
  routeTargets?: RouteTarget[];
  promptConfig?: { nodeId: string; runId: number; senderNode: string; description?: string };
  sessionId?: string;
  input?: unknown;
  workspace?: Workspace;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
  onOutput?: (chunk: string) => void;
};

const modelMap: Record<string, string> = {
  sonnet: "sonnet",
  opus: "opus",
  haiku: "haiku",
};

export async function runClaudeAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { config, input, env, abortSignal, onOutput } = options;
  const ws = options.workspace ?? new Workspace();
  const startTime = Date.now();

  // Build the prompt
  let prompt: string;
  if (input !== undefined && input !== null && input !== "") {
    prompt = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } else {
    prompt = "Start";
  }

  // Build MCP server config from workspace (single source of truth for dirs + configs)
  // Claude SDK supports stdio external MCP servers and in-process SDK MCP servers.
  const mcpServers: Record<string, McpServerConfig> = {};

  if (config.mcpServers?.length) {
    const mcpTools = config.mcpTools ?? [];
    const legacyIds = config.mcpServers.filter(
      (id) => !mcpTools.some((t) => t.toolId === id),
    );
    const resolved = ws.getMcpToolConfigs(mcpTools, legacyIds);
    for (const [id, cfg] of Object.entries(resolved)) {
      // Claude SDK only supports stdio MCP servers for external servers
      if (cfg.transport === "stdio" && cfg.command) {
        mcpServers[id] = { type: "stdio", command: cfg.command, args: cfg.args ?? [], env: cfg.env };
      }
    }
  }

  // In-process workflow MCP server for routing, ask_user, and knowledge tools.
  // Runs in the same process as the server — no subprocess spawn needed, so this
  // works inside Bun compiled binaries (where workflow-mcp-server.ts lives at a
  // virtual bunfs path that a spawned `bun run` cannot reach).
  const routeTargets = options.routeTargets;
  const knowledgeBaseIds = config.knowledgeBases?.map(Number).filter((n) => !isNaN(n)) ?? [];
  const promptConfig = options.promptConfig;
  const apiUrl = process.env.OC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  const routingState: { routeTo?: string; routeContent?: string } = {};

  // Use ReturnType<typeof tool> is not portable across zod generics, so accept
  // heterogeneous tool shapes via a permissive element type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflowTools: any[] = [];

  if (routeTargets && routeTargets.length >= 1) {
    const validIds = routeTargets.map((t) => t.nodeId) as [string, ...string[]];
    const routeDescription = routeTargets
      .map((t) => {
        const desc = (t as { description?: string }).description;
        return `  - "${t.nodeId}" → ${t.label} (${t.type})${desc ? ` — ${desc}` : ""}`;
      })
      .join("\n");

    workflowTools.push(
      tool(
        "openconclave_next",
        [
          "Choose the next step in the workflow. You MUST call this exactly once when you are done.",
          "Available routes:",
          routeDescription,
        ].join("\n"),
        {
          node_id: z.enum(validIds).describe("The ID of the next node to route to"),
          content: z.string().describe("Your output message to pass to the next node"),
        },
        async ({ node_id, content }) => {
          routingState.routeTo = node_id;
          routingState.routeContent = content;
          const target = routeTargets.find((t) => t.nodeId === node_id);
          return {
            content: [{ type: "text", text: `Routing to: ${target?.label ?? node_id}` }],
          };
        },
      ),
    );
  }

  if (promptConfig) {
    workflowTools.push(
      tool(
        "ask_user",
        promptConfig.description ||
          "Ask the user a question and wait for their response. Use when you need clarification or more information.",
        {
          question: z.string().describe("The question to ask the user"),
        },
        async ({ question }) => {
          const res = await fetch(`${apiUrl}/api/prompts/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId: promptConfig.runId,
              nodeId: promptConfig.nodeId,
              question,
              senderNode: promptConfig.senderNode,
            }),
          });
          const data = (await res.json()) as { response?: string; error?: string };
          return {
            content: [{ type: "text", text: data.response ?? data.error ?? "No response received" }],
          };
        },
      ),
    );
  }

  if (knowledgeBaseIds.length > 0) {
    const kbList = knowledgeBaseIds.join(", ");

    workflowTools.push(
      tool(
        "knowledge_search",
        `Search connected knowledge bases (IDs: ${kbList}) using semantic similarity. Returns the most relevant text passages.`,
        {
          query: z.string().describe("The search query"),
          top_k: z.number().optional().describe("Number of results to return (default: 5)"),
          knowledge_base_id: z
            .number()
            .optional()
            .describe(`Specific KB to search. If omitted, searches all connected KBs (${kbList})`),
        },
        async ({ query: searchQuery, top_k, knowledge_base_id }) => {
          const topK = top_k ?? 5;
          const targetIds =
            knowledge_base_id !== undefined ? [knowledge_base_id] : knowledgeBaseIds;

          if (knowledge_base_id !== undefined && !knowledgeBaseIds.includes(knowledge_base_id)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: knowledge base ${knowledge_base_id} is not connected to this agent. Available: ${kbList}`,
                },
              ],
            };
          }

          const allResults: Array<{
            content: string;
            score: number;
            documentName: string;
            chunkIndex: number;
          }> = [];

          for (const kbId of targetIds) {
            try {
              const res = await fetch(`${apiUrl}/api/knowledge/${kbId}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: searchQuery, topK }),
              });
              if (!res.ok) continue;
              const json = (await res.json()) as {
                data: Array<{ content: string; score: number; documentName: string; chunkIndex: number }>;
              };
              allResults.push(...json.data);
            } catch {
              // Skip unreachable KBs
            }
          }

          allResults.sort((a, b) => b.score - a.score);
          const results = allResults.slice(0, topK);

          if (results.length === 0) {
            return { content: [{ type: "text", text: "No relevant results found." }] };
          }

          const formatted = results
            .map(
              (r, i) =>
                `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.documentName} chunk ${r.chunkIndex}]\n${r.content}`,
            )
            .join("\n\n---\n\n");

          return { content: [{ type: "text", text: formatted }] };
        },
      ),
    );

    workflowTools.push(
      tool(
        "knowledge_fetch",
        "Fetch full document content or specific chunks from a knowledge base. Use after searching to get complete context.",
        {
          knowledge_base_id: z.number().describe(`Knowledge base ID (available: ${kbList})`),
          document_id: z.number().describe("Document ID (from search results or document listing)"),
          chunk_index: z
            .number()
            .optional()
            .describe("Specific chunk index to fetch. If omitted, returns all chunks (full document)"),
        },
        async ({ knowledge_base_id, document_id, chunk_index }) => {
          if (!knowledgeBaseIds.includes(knowledge_base_id)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: knowledge base ${knowledge_base_id} is not connected to this agent. Available: ${kbList}`,
                },
              ],
            };
          }

          try {
            const res = await fetch(
              `${apiUrl}/api/knowledge/${knowledge_base_id}/documents/${document_id}/chunks`,
            );
            if (!res.ok) {
              const errText = await res.text();
              return { content: [{ type: "text", text: `Error fetching document: ${errText}` }] };
            }
            const json = (await res.json()) as {
              data: {
                document: { id: number; filename: string; sourcePath: string | null };
                chunks: Array<{ id: number; content: string; chunkIndex: number }>;
              };
            };
            const { document: doc, chunks: docChunks } = json.data;

            if (chunk_index !== undefined) {
              const chunk = docChunks.find((c) => c.chunkIndex === chunk_index);
              if (!chunk) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Chunk ${chunk_index} not found in document "${doc.filename}" (${docChunks.length} chunks available)`,
                    },
                  ],
                };
              }
              return {
                content: [
                  {
                    type: "text",
                    text: `Document: ${doc.filename}\nChunk ${chunk.chunkIndex}/${docChunks.length - 1}:\n\n${chunk.content}`,
                  },
                ],
              };
            }

            const sorted = [...docChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
            const fullText = sorted.map((c) => c.content).join("\n\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Document: ${doc.filename} (${docChunks.length} chunks)\nSource: ${doc.sourcePath ?? "N/A"}\n\n${fullText}`,
                },
              ],
            };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Error: ${msg}` }] };
          }
        },
      ),
    );

    workflowTools.push(
      tool(
        "knowledge_add",
        "Add new text content to a connected knowledge base. The text will be chunked and embedded automatically.",
        {
          knowledge_base_id: z.number().describe(`Knowledge base ID to add to (available: ${kbList})`),
          filename: z.string().describe("A descriptive filename for the content (e.g. 'meeting-notes-2024.txt')"),
          content: z.string().describe("The text content to ingest"),
        },
        async ({ knowledge_base_id, filename, content }) => {
          if (!knowledgeBaseIds.includes(knowledge_base_id)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: knowledge base ${knowledge_base_id} is not connected to this agent. Available: ${kbList}`,
                },
              ],
            };
          }

          try {
            const res = await fetch(`${apiUrl}/api/knowledge/${knowledge_base_id}/ingest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: content, filename }),
            });
            if (!res.ok) {
              const errText = await res.text();
              return { content: [{ type: "text", text: `Error ingesting: ${errText}` }] };
            }
            const json = (await res.json()) as { data: { documentId: number } };
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully added "${filename}" to knowledge base ${knowledge_base_id}. Document ID: ${json.data.documentId}`,
                },
              ],
            };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Error: ${msg}` }] };
          }
        },
      ),
    );
  }

  if (workflowTools.length > 0) {
    mcpServers["openconclave-workflow"] = createSdkMcpServer({
      name: "openconclave-workflow",
      version: "0.1.0",
      tools: workflowTools,
    });
  }

  try {
    const thinkingBlocks: ThinkingBlock[] = [];
    let resultOutput = "";
    let costUsd: number | undefined;
    let sessionId: string | undefined;

    const agentQuery = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: cliPath,
        cwd: ws.cwd,
        env: { ...process.env, ...env } as Record<string, string>,
        model: config.model && modelMap[config.model] ? modelMap[config.model] : undefined,
        systemPrompt: config.systemPrompt,
        maxTurns: config.maxTurns ?? 25,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: config.allowedTools?.length
          ? config.allowedTools
          : { type: "preset" as const, preset: "claude_code" as const },
        mcpServers,
        // Isolate agent from user's personal MCP servers (Gmail, Sknet, etc.)
        // Only servers explicitly passed in mcpServers above will be available.
        strictMcpConfig: true,
        resume: options.sessionId,
        thinking: { type: "enabled" as const, budgetTokens: 31999 },
        stderr: (data: string) => onOutput?.(`[CLI stderr] ${data}`),
      },
    });

    // Consume the async generator
    for await (const message of agentQuery) {
      const msg = message as SDKMessage & { type: string; subtype?: string; [key: string]: unknown };

      // Capture thinking blocks from assistant messages
      if (msg.type === "assistant") {
        const assistantMsg = msg as unknown as { message?: { content?: Array<{ type: string; thinking?: string; signature?: string }> } };
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === "thinking" && block.thinking) {
              thinkingBlocks.push({
                thinking: block.thinking,
                signature: block.signature,
              });
              onOutput?.(`[thinking: ${block.thinking.slice(0, 100)}...]\n`);
            }
          }
        }
      }

      // Capture result
      if (msg.type === "result") {
        const resultMsg = msg as unknown as {
          subtype?: string;
          result?: string;
          total_cost_usd?: number;
          session_id?: string;
          is_error?: boolean;
          errors?: string[];
        };
        if (resultMsg.subtype === "success") {
          resultOutput = resultMsg.result ?? "";
          costUsd = resultMsg.total_cost_usd;
          sessionId = resultMsg.session_id;
        } else {
          // Error result
          const errorMsg = resultMsg.errors?.join("\n") ?? "Agent failed";
          return {
            success: false,
            output: "",
            error: errorMsg,
            costUsd: resultMsg.total_cost_usd,
            durationMs: Date.now() - startTime,
            thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          };
        }
      }
    }

    const durationMs = Date.now() - startTime;

    // Read routing decision from in-process workflow tool state
    let routeTo: string | undefined;
    if (routingState.routeTo) {
      routeTo = routingState.routeTo;
      if (routingState.routeContent) {
        resultOutput = routingState.routeContent;
      }
    }

    return {
      success: true,
      output: resultOutput,
      costUsd,
      durationMs,
      thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      routeTo,
      sessionId,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      error: message,
      durationMs: Date.now() - startTime,
    };
  }
}
