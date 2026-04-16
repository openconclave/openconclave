import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import embeddedCliPath from "@anthropic-ai/claude-agent-sdk/embed";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, existsSync, chmodSync, renameSync, writeFileSync, statSync } from "fs";
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
import { createClaudeAttachmentTools } from "./attachment-tools";
import { createClaudeArtifactTools } from "./artifact-tools";
import { ROUTING_TOOL_NAME } from "./constants";

function findSystemClaude(): string | undefined {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = execFileSync(cmd, ["claude"], { encoding: "utf8", timeout: 3000 }).trim();
    const bin = result.split(/\r?\n/)[0];
    if (bin && existsSync(bin)) return bin;
  } catch { /* not installed */ }
}

// SDK's extractFromBunfs only checks for "$bunfs" but Bun on Windows uses "B:/~BUN/".
// Re-extract here to cover both patterns.
function resolveCliPath(path: string): string {
  const system = findSystemClaude();
  if (system) return system;
  if (!path.includes("$bunfs") && !path.includes("~BUN")) return path;
  let out: string | undefined;
  try {
    const content = readFileSync(path);
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const dir = join(tmpdir(), `claude-agent-sdk-${hash}`);
    out = join(dir, "cli.js");
    if (existsSync(out)) return out;
    // mode 0o700 only applies to directories we newly create; if `dir` already
    // exists with looser perms, mkdirSync leaves it alone. Verify explicitly
    // on POSIX so an attacker with shared-tmpdir access can't pre-place a
    // malicious cli.js under a world-writable directory we then execute.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      const st = statSync(dir);
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        throw new Error(`CLI cache dir ${dir} has mode ${mode.toString(8)}, expected 700`);
      }
    }
    const tmp = join(dir, `cli.js.tmp.${process.pid}`);
    writeFileSync(tmp, content);
    try { chmodSync(tmp, 0o755); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e; }
    renameSync(tmp, out);
    return out;
  } catch (err) {
    // Honest-race recovery: if another process already extracted the file
    // (their renameSync won, ours threw EPERM), return the existing file.
    if (out && existsSync(out)) return out;
    // Any other failure (disk full, permission denied, bad mode) is fatal —
    // returning the bunfs path would let the SDK try to spawn it and fail
    // with a cryptic "no such file" later.
    throw err;
  }
}

export const cliPath = resolveCliPath(embeddedCliPath);
console.log(`[claude-cli] ${cliPath.includes("cli.js") ? "embedded" : "system"}: ${cliPath}`);

// Block secrets from spawned Claude CLI subprocesses. A prompt-injected
// agent with `bypassPermissions` can exfiltrate env vars via MCP servers.
// Strategy: pass everything EXCEPT vars matching secret-like patterns.
const BLOCKED_ENV_PATTERNS = [
  /secret/i,
  /password/i,
  /credential/i,
  /private.?key/i,
  /^database.?url$/i,
  /^redis.?url$/i,
  // `mongo.?uri` missed MONGODB_URI (4 chars between MONGO and URI); broaden.
  /^mongo.*(uri|url)$/i,
  // Cloud-provider creds: AWS_ACCESS_KEY_ID (ends _ID, not _KEY), GOOGLE_APPLICATION_CREDENTIALS, etc.
  /^aws_/i,
  /^azure_/i,
  /^gcp_/i,
  /^google_application_/i,
  // Package-manager / SSH / Kubernetes / DSNs / personal access tokens.
  /^npm_config_/i,
  /^(ssh_auth_sock|kubeconfig)$/i,
  /_dsn$/i,
  /_pat$/i,
  /_(key|token)$/i,
];

function isBlockedEnvKey(key: string): boolean {
  return BLOCKED_ENV_PATTERNS.some((p) => p.test(key));
}

export function buildSubprocessEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!isBlockedEnvKey(k) && v !== undefined) out[k] = v;
  }
  // Apply the same filter to caller-supplied extras so a future caller can't
  // reintroduce blocked keys after the process-env pass.
  for (const [k, v] of Object.entries(extra)) {
    if (!isBlockedEnvKey(k)) out[k] = v;
  }
  return out;
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
  runId?: number;
};

export const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku"]);
const CONCLAVE_MCP_SERVER_ID = "openconclave-conclave";

export async function runClaudeAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { config, input, env, abortController, onOutput } = options;
  // Require an explicit workspace so we never silently fall back to process.cwd()
  // (issue #30: that fallback lets agents escape the run's intended working dir).
  if (!options.workspace) {
    throw new Error("runClaudeAgent requires options.workspace — none was provided");
  }
  const ws = options.workspace;
  const startTime = Date.now();

  let prompt: string;
  const INPUT_MAX_CHARS = 100_000;
  if (input !== undefined && input !== null && input !== "") {
    let raw: string;
    if (typeof input === "string") {
      raw = input;
    } else {
      try {
        raw = JSON.stringify(input, null, 2);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: "",
          error: `Failed to serialize input: ${msg}`,
          durationMs: Date.now() - startTime,
        };
      }
    }
    if (raw.length > INPUT_MAX_CHARS) {
      onOutput?.(`[input truncated from ${raw.length} to ${INPUT_MAX_CHARS} chars]\n`);
      prompt = raw.slice(0, INPUT_MAX_CHARS) + "\n...[truncated]";
    } else {
      prompt = raw;
    }
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
      if (cfg.transport === "stdio" && cfg.command) {
        mcpServers[id] = { type: "stdio", command: cfg.command, args: cfg.args ?? [], env: cfg.env };
      } else if (cfg.transport === "sse" && cfg.url) {
        mcpServers[id] = { type: "sse", url: cfg.url };
      } else if (cfg.transport === "streamable-http" && cfg.url) {
        mcpServers[id] = { type: "http", url: cfg.url };
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
  const ocBuiltins = createBuiltinTools(ws, options.runId);
  const allowedSet = new Set(config.allowedTools ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OC_TOOL_MAP: Record<string, () => any> = {
    Read: () => tool(
      "read",
      "Read the contents of a file from disk and return it as text. Use this before editing a file so you know its exact current state, and any time you need to inspect source code, configuration, logs, or review output. Paths are resolved against your working directory unless absolute.",
      {
        path: z.string().describe("File path — relative to your working directory, or absolute. Example: 'packages/server/src/index.ts'"),
      },
      async ({ path }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.read_file!.execute({ path }) }],
      }),
    ),
    Write: () => tool(
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
    Edit: () => tool(
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
    Grep: () => tool(
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
    Glob: () => tool(
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
    Bash: () => tool(
      "bash",
      "Run a shell command in your working directory. Returns combined stdout/stderr with the exit code. Use this for git operations (status, diff, log, branch, commit), running tests, build commands, package managers, or any shell action. For reading/writing individual files, prefer the dedicated `read`/`write`/`edit` tools — they give cleaner output and stricter error reporting.",
      {
        command: z.string().describe("Shell command to execute. Example: 'git status', 'bun test packages/server', 'ls -la src/'"),
      },
      async ({ command }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.bash!.execute({ command }) }],
      }),
    ),
  };

  // WebFetch is populated by createBuiltinTools only when runId is defined
  // (attachments folder is per-run). Register the SDK tool only then, so a
  // caller that requests WebFetch without runId gets a clear "tool unavailable"
  // signal instead of a cryptic TypeError at invocation time.
  if (ocBuiltins.web_fetch) {
    const webFetch = ocBuiltins.web_fetch;
    OC_TOOL_MAP.WebFetch = () => tool(
      "web_fetch",
      "Fetch a URL with a real headless browser (handles JavaScript and SPAs), extract the main content as Markdown, and save it to this run's attachments folder. Returns a short status with the saved filename — the page content does NOT come back inline. Use list_attachments to see saved files; read_attachment or grep_attachment to read them. Repeated calls for the same URL within a run reuse the first fetch's saved file.",
      {
        url: z.string().describe("Absolute http(s) URL to fetch"),
      },
      async ({ url }) => ({
        content: [{ type: "text" as const, text: await webFetch.execute({ url }) }],
      }),
    );
  }

  const ocFsTools = Object.entries(OC_TOOL_MAP)
    .filter(([name]) => allowedSet.has(name))
    .map(([, factory]) => factory());

  // Attachment + artifact tools are always on when we know the runId.
  // They behave correctly on empty folders ("No attachments.") and become
  // populated when web_fetch or user upload adds files mid-run.
  const runId = options.runId;
  if (runId !== undefined) {
    ocFsTools.push(...createClaudeAttachmentTools(runId));
    ocFsTools.push(...createClaudeArtifactTools(runId));
  }

  if (ocFsTools.length > 0) {
    mcpServers["oc"] = createSdkMcpServer({
      name: "oc",
      version: VERSION,
      tools: ocFsTools,
    });
  }

  // In-process conclave MCP server for routing, ask_user, and knowledge tools.
  // Runs in the same process as the server — no subprocess spawn needed, so this
  // works inside Bun compiled binaries (where conclave-mcp-server.ts lives at a
  // virtual bunfs path that a spawned `bun run` cannot reach).
  const routeTargets = options.routeTargets;
  // Reject empty strings and non-integer inputs — Number("") returns 0, which
  // would silently pass an !isNaN check and authorise KB id 0.
  const knowledgeBaseIds = (config.knowledgeBases ?? [])
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
  const promptConfig = options.promptConfig;
  const routingState: { routeTo?: string; routeContent?: string } = {};

  // Use ReturnType<typeof tool> is not portable across zod generics, so accept
  // heterogeneous tool shapes via a permissive element type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conclaveTools: any[] = [];

  if (routeTargets && routeTargets.length >= 2) {
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
            return { content: [{ type: "text", text: `Error: route already set to ${routingState.routeTo} — cannot route twice.` }] };
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
              abortController?.signal,
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
          query: z.string().max(2000).describe("The search query"),
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
                  `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.documentName} chunk ${r.chunkIndex}] (doc_id: ${r.documentId}, kb: ${r.knowledgeBaseId})\n${r.content}`,
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
    const passthroughTools = (config.allowedTools ?? []).filter(
      (t) => !(t in OC_TOOL_MAP),
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
      routeTo: routingState.routeTo,
    };
  }
}
