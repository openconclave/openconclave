import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import embeddedCliPath from "@anthropic-ai/claude-agent-sdk/embed";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, existsSync, chmodSync, renameSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ResolvedAgentConfig } from "@openconclave/shared";
import { VERSION } from "@openconclave/shared";
import { Workspace } from "../engine/workspace";
import type { RouteTarget } from "../engine/types";
import { db } from "../db/client";
import { documents, chunks } from "../db/schema";
import { searchMultipleKBs } from "../knowledge/search";
import { ingestText } from "../knowledge/ingest";
import { registerPrompt } from "../engine/prompt-registry";
import { broadcastRunEvent } from "../ws/broadcast";
import { createBuiltinTools } from "./builtin-tools";
import { ROUTING_TOOL_NAME } from "./constants";

// SDK's extractFromBunfs only checks for "$bunfs" but Bun on Windows uses "B:/~BUN/".
// Re-extract here to cover both patterns.
function resolveCliPath(path: string): string {
  if (!path.includes("$bunfs") && !path.includes("~BUN")) return path;
  let out: string | undefined;
  try {
    const content = readFileSync(path);
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const dir = join(tmpdir(), `claude-agent-sdk-${hash}`);
    out = join(dir, "cli.js");
    if (existsSync(out)) return out;
    // mode 0o700 prevents other users on the host from pre-placing a malicious
    // cli.js in this directory under a permissive umask.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `cli.js.tmp.${process.pid}`);
    writeFileSync(tmp, content);
    try { chmodSync(tmp, 0o755); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e; }
    renameSync(tmp, out);
    return out;
  } catch {
    // Honest-race recovery: if another process already extracted the file
    // (their renameSync won, ours threw EPERM), return the existing file
    // instead of falling back to the unresolvable bunfs path.
    if (out && existsSync(out)) return out;
    return path;
  }
}

export const cliPath = resolveCliPath(embeddedCliPath);

// Minimal environment for spawned Claude CLI subprocesses. Wholesale
// `process.env` forwarding with `bypassPermissions` lets a prompt-injected
// agent exfiltrate secrets like DATABASE_URL to third-party MCP servers.
const ALLOWED_SUBPROCESS_ENV = new Set([
  "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "TMPDIR", "TMP", "TEMP",
  "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
  "NODE_ENV", "DEBUG",
  "OC_API_URL", "OC_WS_URL",
  "SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "windir",
]);

export function buildSubprocessEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (ALLOWED_SUBPROCESS_ENV.has(k) && v !== undefined) out[k] = v;
  }
  return { ...out, ...extra };
}

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


export type AgentRunOptions = {
  config: ResolvedAgentConfig;
  routeTargets?: RouteTarget[];
  promptConfig?: { nodeId: string; runId: number; senderNode: string; description?: string };
  sessionId?: string;
  input?: unknown;
  workspace?: Workspace;
  env?: Record<string, string>;
  abortController?: AbortController;
  onOutput?: (chunk: string) => void;
};

export const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku"]);
const CONCLAVE_MCP_SERVER_ID = "openconclave-conclave";

export async function runClaudeAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { config, input, env, abortController, onOutput } = options;
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

  // Workspace filesystem tools, served in-process under the "oc" MCP server.
  // The model sees them as mcp__oc__read / mcp__oc__write / mcp__oc__edit /
  // mcp__oc__grep / mcp__oc__glob / mcp__oc__bash.
  //
  // These wrap OC's existing createBuiltinTools(workspace), which resolves every
  // path via workspace.resolve() and therefore stays inside the run's cwd.
  // They replace the Claude Code CLI's builtin Read/Write/Edit/Grep/Glob, whose
  // path-resolution walks .git upward and escapes git worktrees to the main repo.
  // See issue #30.
  const ocBuiltins = createBuiltinTools(ws);
  const ocFsTools = [
    tool(
      "read",
      "Read the contents of a file from disk and return it as text. Use this before editing a file so you know its exact current state, and any time you need to inspect source code, configuration, logs, or review output. Paths are resolved against your working directory unless absolute.",
      {
        path: z.string().describe("File path — relative to your working directory, or absolute. Example: 'packages/server/src/index.ts'"),
      },
      async ({ path }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.read_file!.execute({ path }) }],
      }),
    ),
    tool(
      "write",
      "Create a new file or completely replace an existing file's contents. The entire file is overwritten — for surgical changes to an existing file, use `edit` instead. Parent directories are created if missing. Returns confirmation on success.",
      {
        path: z.string().describe("File path — relative to your working directory, or absolute"),
        content: z.string().describe("Full file contents to write. Overwrites any existing file at this path."),
      },
      async ({ path, content }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.write_file!.execute({ path, content }) }],
      }),
    ),
    tool(
      "edit",
      "Modify an existing file by replacing an exact substring. Prefer this over `write` for any change to an already-existing file — it keeps diffs minimal and preserves surrounding code. old_string must match the file character-for-character including all whitespace, newlines, and indentation. If old_string appears more than once, either widen it with more surrounding context to make it unique, or set replace_all to true to replace every occurrence.",
      {
        path: z.string().describe("File path — relative to your working directory, or absolute"),
        old_string: z.string().describe("Exact text to find. Whitespace, newlines, and indentation must match the file verbatim."),
        new_string: z.string().describe("Replacement text. Pass an empty string to delete old_string."),
        replace_all: z.boolean().optional().describe("Replace every occurrence. Default false — requires one unique match or the call errors."),
      },
      async ({ path, old_string, new_string, replace_all }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.edit!.execute({ path, old_string, new_string, replace_all }) }],
      }),
    ),
    tool(
      "grep",
      "Search file contents across the codebase for a JavaScript-flavor regular expression. Returns matches as `path:line:content`. Skips node_modules, .git, dist, build, .worktrees, and files larger than 2MB. Use this to locate symbol definitions, call sites, error messages, or any text pattern. For finding files by name (not content), use `glob` instead.",
      {
        pattern: z.string().describe("JavaScript regex. Example: 'export function \\\\w+' or 'TODO[^\\\\n]*'"),
        path: z.string().optional().describe("Subdirectory to search in. Default: your working directory."),
        glob: z.string().optional().describe("File-glob filter to restrict which files are searched. Example: '*.ts' or '**/*.{ts,tsx}'. Default: '**/*'."),
        ignore_case: z.boolean().optional().describe("Case-insensitive match. Default false."),
        max_results: z.number().int().optional().describe("Maximum number of match lines to return. Default 100."),
      },
      async (args) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.grep!.execute(args as Record<string, unknown>) }],
      }),
    ),
    tool(
      "glob",
      "List files whose paths match a glob pattern. Returns sorted paths relative to the search base. Use this to discover files by name or extension — for example, finding every test file (`**/*.test.ts`), every component (`packages/*/src/components/**/*.tsx`), or every config (`**/tsconfig*.json`). For searching file *contents*, use `grep` instead.",
      {
        pattern: z.string().describe("Glob pattern. Examples: '**/*.ts', 'src/**/*.tsx', 'packages/*/package.json'"),
        path: z.string().optional().describe("Subdirectory to search in. Default: your working directory."),
      },
      async (args) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.glob!.execute(args as Record<string, unknown>) }],
      }),
    ),
    tool(
      "bash",
      "Run a shell command in your working directory. Returns combined stdout/stderr with the exit code. Use this for git operations (status, diff, log, branch, commit), running tests, build commands, package managers, or any shell action. For reading/writing individual files, prefer the dedicated `read`/`write`/`edit` tools — they give cleaner output and stricter error reporting.",
      {
        command: z.string().describe("Shell command to execute. Example: 'git status', 'bun test packages/server', 'ls -la src/'"),
      },
      async ({ command }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.bash!.execute({ command }) }],
      }),
    ),
  ];
  mcpServers["oc"] = createSdkMcpServer({
    name: "oc",
    version: VERSION,
    tools: ocFsTools,
  });

  // In-process conclave MCP server for routing, ask_user, and knowledge tools.
  // Runs in the same process as the server — no subprocess spawn needed, so this
  // works inside Bun compiled binaries (where conclave-mcp-server.ts lives at a
  // virtual bunfs path that a spawned `bun run` cannot reach).
  const routeTargets = options.routeTargets;
  const knowledgeBaseIds = config.knowledgeBases?.map(Number).filter((n) => !isNaN(n)) ?? [];
  const promptConfig = options.promptConfig;
  const routingState: { routeTo?: string; routeContent?: string } = {};

  // Use ReturnType<typeof tool> is not portable across zod generics, so accept
  // heterogeneous tool shapes via a permissive element type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conclaveTools: any[] = [];

  if (routeTargets && routeTargets.length >= 1) {
    const validIds = routeTargets.map((t) => t.nodeId) as [string, ...string[]];
    const routeDescription = routeTargets
      .map((t) => {
        const desc = t.description;
        return `  - "${t.nodeId}" → ${t.label} (${t.type})${desc ? ` — ${desc}` : ""}`;
      })
      .join("\n");

    conclaveTools.push(
      tool(
        ROUTING_TOOL_NAME,
        [
          "Choose the next step in the conclave.",
          "Available routes:",
          routeDescription,
        ].join("\n"),
        {
          node_id: z.enum(validIds).describe("The ID of the next node to route to"),
          content: z.string().describe("Your output message to pass to the next node"),
        },
        async ({ node_id, content }) => {
          if (routingState.routeTo) {
            return { isError: true, content: [{ type: "text", text: `Route already set to ${routingState.routeTo} — cannot route twice.` }] };
          }
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
    conclaveTools.push(
      tool(
        "ask_user",
        promptConfig.description ||
          "Ask the user a question and wait for their response. Use when you need clarification or more information.",
        {
          question: z.string().describe("The question to ask the user"),
        },
        async ({ question }) => {
          try {
            broadcastRunEvent({
              type: "prompt:question",
              runId: promptConfig.runId,
              nodeId: promptConfig.nodeId,
              data: {
                question,
                waitingForResponse: true,
                conclaveName: "",
                nodeLabel: promptConfig.nodeId,
                senderNode: promptConfig.senderNode ?? "agent",
                senderType: "agent",
              },
            });
            const response = await registerPrompt(
              promptConfig.runId,
              promptConfig.nodeId,
              question,
              null,
            );
            return { content: [{ type: "text", text: response }] };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Error asking user: ${msg}` }] };
          }
        },
      ),
    );
  }

  if (knowledgeBaseIds.length > 0) {
    const kbList = knowledgeBaseIds.join(", ");

    conclaveTools.push(
      tool(
        "knowledge_search",
        `Search connected knowledge bases (IDs: ${kbList}) using semantic similarity. Returns the most relevant text passages.`,
        {
          query: z.string().describe("The search query"),
          top_k: z.number().int().min(1).max(100).optional().describe("Number of results to return (default: 5)"),
          knowledge_base_id: z
            .number()
            .optional()
            .describe(`Specific KB to search. If omitted, searches all connected KBs (${kbList})`),
        },
        async ({ query: searchQuery, top_k, knowledge_base_id }) => {
          try {
            const topK = top_k ?? 5;

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

            const targetIds =
              knowledge_base_id !== undefined ? [knowledge_base_id] : knowledgeBaseIds;
            const results = await searchMultipleKBs(targetIds, searchQuery, topK);

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
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Error searching knowledge: ${msg}` }] };
          }
        },
      ),
    );

    conclaveTools.push(
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
          try {
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

            const doc = await db
              .select()
              .from(documents)
              .where(eq(documents.id, document_id))
              .get();
            if (!doc || doc.knowledgeBaseId !== knowledge_base_id) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: document ${document_id} not found in knowledge base ${knowledge_base_id}`,
                  },
                ],
              };
            }

            const docChunks = await db
              .select({
                content: chunks.content,
                chunkIndex: chunks.chunkIndex,
              })
              .from(chunks)
              .where(eq(chunks.documentId, document_id));

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
            return { content: [{ type: "text", text: `Error fetching document: ${msg}` }] };
          }
        },
      ),
    );

    conclaveTools.push(
      tool(
        "knowledge_add",
        "Add new text content to a connected knowledge base. The text will be chunked and embedded automatically.",
        {
          knowledge_base_id: z.number().describe(`Knowledge base ID to add to (available: ${kbList})`),
          filename: z.string().max(255).describe("A descriptive filename for the content (e.g. 'meeting-notes-2024.txt')"),
          content: z.string().max(500_000).describe("The text content to ingest"),
        },
        async ({ knowledge_base_id, filename, content }) => {
          try {
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

            const documentId = await ingestText(knowledge_base_id, filename, content);
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully added "${filename}" to knowledge base ${knowledge_base_id}. Document ID: ${documentId}`,
                },
              ],
            };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Error ingesting: ${msg}` }] };
          }
        },
      ),
    );
  }

  if (conclaveTools.length > 0) {
    mcpServers[CONCLAVE_MCP_SERVER_ID] = createSdkMcpServer({
      name: CONCLAVE_MCP_SERVER_ID,
      version: VERSION,
      tools: conclaveTools,
    });
  }

  try {
    const thinkingBlocks: ThinkingBlock[] = [];
    let resultOutput = "";
    let costUsd: number | undefined;
    let sessionId: string | undefined;

    // Filter out filesystem builtins — they're replaced by our in-process
    // mcp__oc__* tools above, which honor workspace.cwd correctly. Any
    // other builtins (WebSearch, WebFetch, LSP, etc.) declared by the
    // agent are kept. If the agent declared nothing, we pass [] so the
    // CLI preset doesn't sneak the bugged Read/Write/Edit back in.
    const OC_REPLACED_BUILTINS = new Set(["Read", "Write", "Edit", "Grep", "Glob", "Bash"]);
    const passthroughTools = (config.allowedTools ?? []).filter(
      (t) => !OC_REPLACED_BUILTINS.has(t),
    );

    const agentQuery = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: cliPath,
        cwd: ws.cwd,
        env: buildSubprocessEnv(env ?? {}),
        model: ALLOWED_MODELS.has(config.model ?? "") ? config.model : undefined,
        systemPrompt: config.systemPrompt,
        maxTurns: config.maxTurns ?? 25,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: passthroughTools,
        mcpServers,
        // Isolate agent from user's personal MCP servers (Gmail, Sknet, etc.)
        // Only servers explicitly passed in mcpServers above will be available.
        strictMcpConfig: true,
        resume: options.sessionId,
        thinking: config.thinking === false
          ? { type: "disabled" as const }
          : { type: "enabled" as const, budgetTokens: 31999 },
        stderr: (data: string) => onOutput?.(`[CLI stderr] ${data}`),
        abortController,
      },
    });

    // Consume the async generator
    for await (const message of agentQuery) {
      const msg = message as SDKMessage & { type: string; subtype?: string; [key: string]: unknown };

      // Capture thinking + tool-use blocks from assistant messages
      if (msg.type === "assistant") {
        const assistantMsg = msg as unknown as {
          message?: {
            content?: Array<{
              type: string;
              thinking?: string;
              signature?: string;
              name?: string;
              input?: unknown;
            }>;
          };
        };
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === "thinking" && block.thinking) {
              thinkingBlocks.push({
                thinking: block.thinking,
                signature: block.signature,
              });
              onOutput?.(`[thinking: ${block.thinking.slice(0, 100)}...]\n`);
            } else if (block.type === "tool_use" && block.name) {
              // Emit one event per tool invocation for observability.
              // Truncate args to keep run_events manageable — full input is in the SDK stream.
              let argSummary = "";
              try {
                const json = JSON.stringify(block.input ?? {});
                argSummary = json.length > 200 ? json.slice(0, 200) + "…" : json;
              } catch {
                argSummary = "(unserializable)";
              }
              onOutput?.(`[tool: ${block.name}(${argSummary})]\n`);
            }
          }
        }
      }

      // Emit tool results from user messages so we can see what came back.
      if (msg.type === "user") {
        const userMsg = msg as unknown as {
          message?: {
            content?: Array<{
              type: string;
              tool_use_id?: string;
              content?: string | Array<{ type: string; text?: string }>;
              is_error?: boolean;
            }>;
          };
        };
        if (userMsg.message?.content) {
          for (const block of userMsg.message.content) {
            if (block.type === "tool_result") {
              let resultText = "";
              if (typeof block.content === "string") {
                resultText = block.content;
              } else if (Array.isArray(block.content)) {
                resultText = block.content
                  .filter((b) => b.type === "text" && typeof b.text === "string")
                  .map((b) => b.text)
                  .join("");
              }
              // Truncate aggressively — full results are available via the session file
              // and may be large. Keep the event stream lightweight.
              const preview = resultText.length > 300
                ? resultText.slice(0, 300) + "…"
                : resultText;
              const tag = block.is_error ? "tool_error" : "tool_result";
              onOutput?.(`[${tag}: ${preview}]\n`);
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
            output: routingState.routeContent ?? "",
            error: errorMsg,
            costUsd: resultMsg.total_cost_usd,
            durationMs: Date.now() - startTime,
            thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
            routeTo: routingState.routeTo,
            sessionId: resultMsg.session_id,
          };
        }
      }
    }

    const durationMs = Date.now() - startTime;

    // Read routing decision from in-process conclave tool state
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
