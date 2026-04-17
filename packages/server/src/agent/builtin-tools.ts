import { spawn } from "bun";
import { join } from "path";
import { logger } from "../lib/logger";
import { Workspace } from "../engine/workspace";
import { buildSubprocessEnv } from "./subprocess-env";
import { webFetch, formatFetchResult } from "./web-fetch";

const BASH_TIMEOUT_MS = 60_000;
const BASH_OUTPUT_CAP_BYTES = 4 * 1024 * 1024;
const READ_FILE_CAP_BYTES = 5 * 1024 * 1024;
const WRITE_FILE_CAP_BYTES = 5 * 1024 * 1024;
// Full-document knowledge fetches can blow the model's context. Cap conservatively
// and instruct the agent to fetch specific chunks if they need more.
const KB_FULL_DOC_CAP_CHARS = 200_000;
const GREP_WALLCLOCK_BUDGET_MS = 10_000;
// Source-code lines rarely exceed a few KB; 100KB covers all reasonable cases
// while still bounding regex runtime on truly pathological input. The tool
// description documents that lines past this length may miss matches.
const GREP_LINE_LENGTH_CAP = 100_000;

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface BuiltinTool {
  tool: ToolDef;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export function createBuiltinTools(workspace: Workspace, runId?: number): Record<string, BuiltinTool> {
  const resolveIn = (p: string) => workspace.resolveInside(p);
  const webFetchTools = runId !== undefined ? createWebFetchBuiltin(runId) : {};
  return {
    ...webFetchTools,
    bash: {
      tool: {
        type: "function",
        function: {
          name: "bash",
          description:
            `Run a shell command and return its output. Wall-clock timeout ${BASH_TIMEOUT_MS / 1000}s; output capped at ${BASH_OUTPUT_CAP_BYTES / (1024 * 1024)}MB per stream.`,
          parameters: {
            type: "object",
            required: ["command"],
            properties: {
              command: { type: "string", description: "The shell command to execute" },
            },
          },
        },
      },
      execute: async (args) => {
        const command = typeof args.command === "string" ? args.command : "";
        if (!command) return "Error: command is required (non-empty string).";
        return runBash(command, workspace.cwd);
      },
    },
    read_file: {
      tool: {
        type: "function",
        function: {
          name: "read_file",
          description: "Read the contents of a file",
          parameters: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string", description: "Absolute or relative file path" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const file = Bun.file(resolveIn(args.path as string));
          if (!(await file.exists())) return `Error: file not found: ${args.path}`;
          if (file.size > READ_FILE_CAP_BYTES) {
            return `Error: file exceeds ${READ_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${file.size} bytes). Use grep or a smaller range.`;
          }
          return await file.text();
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    write_file: {
      tool: {
        type: "function",
        function: {
          name: "write_file",
          description: "Write content to a file. Path is resolved against the agent's working directory.",
          parameters: {
            type: "object",
            required: ["path", "content"],
            properties: {
              path: { type: "string", description: "File path, relative to cwd or absolute" },
              content: { type: "string", description: "Content to write" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const content = args.content as string;
          const byteLen = Buffer.byteLength(content, "utf-8");
          if (byteLen > WRITE_FILE_CAP_BYTES) {
            return `Error: content exceeds ${WRITE_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${byteLen} bytes).`;
          }
          await Bun.write(resolveIn(args.path as string), content);
          return `File written: ${args.path}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    edit: {
      tool: {
        type: "function",
        function: {
          name: "edit",
          description:
            "Edit a file by replacing an exact string with a new one. old_string must match exactly — whitespace, newlines, indentation all count. If old_string appears multiple times, set replace_all to true or add more surrounding context to make it unique. Path is resolved against the agent's working directory.",
          parameters: {
            type: "object",
            required: ["path", "old_string", "new_string"],
            properties: {
              path: { type: "string", description: "File path, relative to cwd or absolute" },
              old_string: {
                type: "string",
                description: "Exact text to find. Whitespace and newlines must match.",
              },
              new_string: { type: "string", description: "Replacement text." },
              replace_all: {
                type: "boolean",
                description:
                  "Replace every occurrence (default false — one unique match required).",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const filePath = resolveIn(args.path as string);
          const oldStr = args.old_string as string;
          const newStr = args.new_string as string;
          const replaceAll = args.replace_all === true;

          // An empty old_string matches every zero-width gap between characters.
          // `"abc".split("").join("X")` → "XaXbXcX" — destroys the file silently.
          // `"abc".includes("")` is also always true, so the "not found" guard
          // below wouldn't catch it. Reject explicitly.
          if (oldStr.length === 0) {
            return "Error: old_string must not be empty.";
          }

          const file = Bun.file(filePath);
          if (!(await file.exists())) {
            return `Error: file not found: ${args.path}`;
          }
          if (file.size > READ_FILE_CAP_BYTES) {
            return `Error: file exceeds ${READ_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${file.size} bytes). Use bash + sed/awk for large files.`;
          }
          const content = await file.text();
          if (!content.includes(oldStr)) {
            return `Error: old_string not found. Make sure whitespace and newlines match exactly.`;
          }

          let updated: string;
          if (replaceAll) {
            updated = content.split(oldStr).join(newStr);
          } else {
            const firstIdx = content.indexOf(oldStr);
            const secondIdx = content.indexOf(oldStr, firstIdx + oldStr.length);
            if (secondIdx !== -1) {
              return `Error: old_string matches multiple times. Add more surrounding context to make it unique, or set replace_all: true.`;
            }
            updated = content.slice(0, firstIdx) + newStr + content.slice(firstIdx + oldStr.length);
          }

          await Bun.write(filePath, updated);
          return `File edited: ${args.path}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    glob: {
      tool: {
        type: "function",
        function: {
          name: "glob",
          description:
            "Find files matching a glob pattern. Returns paths relative to the search base, sorted alphabetically. Searches the agent's working directory unless a path is given.",
          parameters: {
            type: "object",
            required: ["pattern"],
            properties: {
              pattern: {
                type: "string",
                description: "Glob pattern, e.g. '**/*.ts', 'src/**/*.tsx'",
              },
              path: {
                type: "string",
                description: "Optional subdirectory to search (relative to cwd or absolute).",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const pattern = args.pattern as string;
          const base = args.path ? resolveIn(args.path as string) : workspace.cwd;
          const glob = new Bun.Glob(pattern);
          const matches: string[] = [];
          const cap = 1000;
          // Memory ceiling: don't collect unbounded matches on a huge monorepo,
          // but collect well past `cap` so the sort reflects true alphabetical
          // order across the matched set instead of filesystem iteration order.
          const collectLimit = 10 * cap;
          for await (const file of glob.scan({ cwd: base, onlyFiles: true, dot: false })) {
            if (!workspace.isInsideAllowed(join(base, file))) continue;
            matches.push(file);
            if (matches.length >= collectLimit) break;
          }
          matches.sort();
          if (matches.length === 0) return `No files matching ${pattern} under ${base}`;
          if (matches.length > cap) {
            return `${cap}+ files matching ${pattern} (showing first ${cap} alphabetically):\n${matches.slice(0, cap).join("\n")}`;
          }
          return `${matches.length} file(s) matching ${pattern}:\n${matches.join("\n")}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    grep: {
      tool: {
        type: "function",
        function: {
          name: "grep",
          description:
            "Search file contents for a regex pattern (JavaScript flavor). Returns matches as 'path:line:content'. Searches the agent's working directory unless a path is given. Skips node_modules, .git, dist, build, .worktrees, and files over 2MB. Lines longer than 100KB are truncated for the match test, so matches past that length on such lines may be missed.",
          parameters: {
            type: "object",
            required: ["pattern"],
            properties: {
              pattern: { type: "string", description: "Regex pattern (JavaScript)" },
              path: {
                type: "string",
                description: "Directory to search (relative to cwd or absolute).",
              },
              glob: {
                type: "string",
                description:
                  "File glob to restrict search, e.g. '*.ts' or '**/*.{ts,tsx}'. Defaults to '**/*'.",
              },
              ignore_case: {
                type: "boolean",
                description: "Case-insensitive matching (default false)",
              },
              max_results: {
                type: "number",
                description: "Max match lines returned (default 100)",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const pattern = args.pattern as string;
          const baseDir = args.path ? resolveIn(args.path as string) : workspace.cwd;
          const fileGlob = typeof args.glob === "string" ? args.glob : "**/*";
          const ignoreCase = args.ignore_case === true;
          const maxResults = typeof args.max_results === "number" && args.max_results > 0
            ? args.max_results
            : 100;

          let re: RegExp;
          try {
            re = new RegExp(pattern, ignoreCase ? "i" : "");
          } catch (err) {
            return `Error: invalid regex: ${err instanceof Error ? err.message : String(err)}`;
          }

          const skipDirs = new Set([
            "node_modules",
            ".git",
            "dist",
            "build",
            ".next",
            ".worktrees",
          ]);

          const glob = new Bun.Glob(fileGlob);
          const matches: string[] = [];
          const startedAt = Date.now();
          let timedOut = false;

          outer: for await (const relPath of glob.scan({ cwd: baseDir, onlyFiles: true, dot: false })) {
            if (matches.length >= maxResults) break;
            if (Date.now() - startedAt > GREP_WALLCLOCK_BUDGET_MS) {
              timedOut = true;
              break;
            }
            if (relPath.split(/[\\/]/).some((seg) => skipDirs.has(seg))) continue;

            const absPath = join(baseDir, relPath);
            if (!workspace.isInsideAllowed(absPath)) continue;
            try {
              const file = Bun.file(absPath);
              if (file.size > 2 * 1024 * 1024) continue;
              const text = await file.text();
              for (const [i, line] of text.split("\n").entries()) {
                if (matches.length >= maxResults) break outer;
                if (Date.now() - startedAt > GREP_WALLCLOCK_BUDGET_MS) {
                  timedOut = true;
                  break outer;
                }
                const bounded = line.length > GREP_LINE_LENGTH_CAP ? line.slice(0, GREP_LINE_LENGTH_CAP) : line;
                if (re.test(bounded)) {
                  const trimmed = line.trim().slice(0, 300);
                  matches.push(`${relPath}:${i + 1}:${trimmed}`);
                }
              }
            } catch {
              // skip unreadable files (binary, permissions)
            }
          }

          if (matches.length === 0 && !timedOut) {
            return `No matches for /${pattern}/${ignoreCase ? "i" : ""} in ${baseDir}`;
          }
          const notes: string[] = [];
          if (matches.length >= maxResults) notes.push(`truncated at ${maxResults} matches`);
          if (timedOut) notes.push(`search budget ${GREP_WALLCLOCK_BUDGET_MS / 1000}s exceeded`);
          const note = notes.length ? `\n(${notes.join("; ")})` : "";
          return `${matches.length} match(es):\n${matches.join("\n")}${note}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    search_knowledge: {
      tool: {
        type: "function",
        function: {
          name: "search_knowledge",
          description:
            "Search knowledge bases for relevant information using semantic similarity",
          parameters: {
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string", description: "The search query" },
              knowledge_base_id: {
                type: "number",
                description:
                  "Optional: specific knowledge base ID to search. If omitted, searches all knowledge bases.",
              },
              top_k: {
                type: "number",
                description: "Number of results to return (default: 5)",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const { searchKnowledgeBase, searchMultipleKBs } = await import(
            "../knowledge/search"
          );
          const query = args.query as string;
          const topK = (args.top_k as number | undefined) ?? 5;
          const kbId = args.knowledge_base_id as number | undefined;

          let results;
          if (kbId !== undefined) {
            results = await searchKnowledgeBase(kbId, query, topK);
          } else {
            const { db: dbClient } = await import("../db/client");
            const { knowledgeBases: kbTable } = await import("../db/schema");
            const allKBs = await dbClient.select({ id: kbTable.id }).from(kbTable);
            const kbIds = allKBs.map((kb) => kb.id);

            if (kbIds.length === 0) {
              return "No knowledge bases found. Create one first via the Knowledge API.";
            }

            results = await searchMultipleKBs(kbIds, query, topK);
          }

          if (results.length === 0) {
            return "No relevant results found.";
          }

          const formatted = results
            .map(
              (r, i) =>
                `[${i + 1}] (score: ${r.score.toFixed(3)}) [kb:${r.knowledgeBaseId} doc:${r.documentId} chunk:${r.chunkIndex}] ${r.documentName}\n${r.content}`,
            )
            .join("\n\n---\n\n");

          return formatted;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("search_knowledge tool error", { error: msg });
          return `Error searching knowledge base: ${msg}`;
        }
      },
    },
    knowledge_fetch: {
      tool: {
        type: "function",
        function: {
          name: "knowledge_fetch",
          description:
            "Fetch full document content or specific chunks from a knowledge base",
          parameters: {
            type: "object",
            required: ["knowledge_base_id", "document_id"],
            properties: {
              knowledge_base_id: {
                type: "number",
                description: "Knowledge base ID",
              },
              document_id: {
                type: "number",
                description: "Document ID (from search results)",
              },
              chunk_index: {
                type: "number",
                description:
                  "Specific chunk index. If omitted, returns all chunks (full document).",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const { db: dbClient } = await import("../db/client");
          const { documents: docsTable, chunks: chunksTable } = await import("../db/schema");
          const { eq } = await import("drizzle-orm");

          const kbId = args.knowledge_base_id as number;
          const docId = args.document_id as number;
          const chunkIdx = args.chunk_index as number | undefined;

          const doc = await dbClient
            .select()
            .from(docsTable)
            .where(eq(docsTable.id, docId))
            .get();

          if (!doc || doc.knowledgeBaseId !== kbId) {
            return `Document ${docId} not found in knowledge base ${kbId}.`;
          }

          const docChunks = await dbClient
            .select({
              content: chunksTable.content,
              chunkIndex: chunksTable.chunkIndex,
            })
            .from(chunksTable)
            .where(eq(chunksTable.documentId, docId));

          if (chunkIdx !== undefined) {
            const chunk = docChunks.find((c) => c.chunkIndex === chunkIdx);
            if (!chunk) {
              return `Chunk ${chunkIdx} not found in document "${doc.filename}" (${docChunks.length} chunks available).`;
            }
            return `Document: ${doc.filename}\nChunk ${chunk.chunkIndex}/${docChunks.length - 1}:\n\n${chunk.content}`;
          }

          const sorted = [...docChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
          const fullText = sorted.map((c) => c.content).join("\n\n");
          if (fullText.length > KB_FULL_DOC_CAP_CHARS) {
            const truncated = fullText.slice(0, KB_FULL_DOC_CAP_CHARS);
            return `Document: ${doc.filename} (${docChunks.length} chunks, truncated at ${KB_FULL_DOC_CAP_CHARS} chars — fetch individual chunks by chunk_index for more)\nSource: ${doc.sourcePath ?? "N/A"}\n\n${truncated}`;
          }
          return `Document: ${doc.filename} (${docChunks.length} chunks)\nSource: ${doc.sourcePath ?? "N/A"}\n\n${fullText}`;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("knowledge_fetch tool error", { error: msg });
          return `Error fetching document: ${msg}`;
        }
      },
    },
    knowledge_add: {
      tool: {
        type: "function",
        function: {
          name: "knowledge_add",
          description:
            "Add new text content to a knowledge base. Text will be chunked and embedded automatically.",
          parameters: {
            type: "object",
            required: ["knowledge_base_id", "filename", "content"],
            properties: {
              knowledge_base_id: {
                type: "number",
                description: "Knowledge base ID to add to",
              },
              filename: {
                type: "string",
                description:
                  "A descriptive filename (e.g. 'meeting-notes-2024.txt')",
              },
              content: {
                type: "string",
                description: "The text content to ingest",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const { ingestText } = await import("../knowledge/ingest");
          const kbId = args.knowledge_base_id as number;
          const filename = args.filename as string;
          const content = args.content as string;
          const docId = await ingestText(kbId, filename, content);
          return `Successfully added "${filename}" to knowledge base ${kbId}. Document ID: ${docId}`;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("knowledge_add tool error", { error: msg });
          return `Error adding to knowledge base: ${msg}`;
        }
      },
    },
  };
}

// Maps Claude Code tool names to builtin tool IDs.
// Any tool listed in the frontend tool picker (packages/client/src/components/editor/tool-picker.tsx)
// MUST have an entry here AND a matching executor in createBuiltinTools() above,
// otherwise non-Claude agents will silently drop the tool when building their catalog.
export const TOOL_NAME_MAP: Record<string, string> = {
  Bash: "bash",
  Read: "read_file",
  Write: "write_file",
  Edit: "edit",
  Glob: "glob",
  Grep: "grep",
  WebFetch: "web_fetch",
};

/**
 * Run bash under an allowlisted env with concurrent pipe drain, wall-clock
 * timeout, and per-stream output cap. Returns a human-readable result string.
 *
 * The three concerns — sequential drain deadlocks on large stderr, absent
 * timeout lets long commands pin the caller, and inherited env leaks secrets
 * to the subprocess — are addressed together because they share the spawn call.
 */
export async function runBash(
  command: string,
  cwd: string,
  opts: { timeoutMs?: number; outputCapBytes?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? BASH_TIMEOUT_MS;
  const capBytes = opts.outputCapBytes ?? BASH_OUTPUT_CAP_BYTES;
  let proc: ReturnType<typeof spawn> | undefined;
  let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stderrReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    proc = spawn({
      cmd: ["bash", "-c", command],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: buildSubprocessEnv(),
    });

    stdoutReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();

    type Outcome =
      | { kind: "exit"; stdout: string; stderr: string; exitCode: number }
      | { kind: "timeout" };

    const normalRun: Promise<Outcome> = (async () => {
      const [stdoutRes, stderrRes, exitCode] = await Promise.all([
        collectCappedFromReader(stdoutReader!, capBytes),
        collectCappedFromReader(stderrReader!, capBytes),
        proc!.exited,
      ]);
      return { kind: "exit", stdout: stdoutRes.text, stderr: stderrRes.text, exitCode };
    })();

    // On timeout, kill the process AND cancel the readers. Cancelling makes
    // any pending `read()` return {done: true}, so collectCappedFromReader exits
    // its loop and releases the lock in finally. Without cancel, on Windows where
    // kill often doesn't propagate to grandchildren, the reader would stay locked
    // indefinitely.
    const timeoutRun: Promise<Outcome> = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        try { proc?.kill(); } catch { /* already dead */ }
        stdoutReader?.cancel().catch(() => { /* reader might already be done */ });
        stderrReader?.cancel().catch(() => { /* reader might already be done */ });
        resolve({ kind: "timeout" });
      }, timeoutMs);
    });

    const outcome = await Promise.race([normalRun, timeoutRun]);

    if (outcome.kind === "timeout") {
      return `Error: command timed out after ${timeoutMs / 1000}s (process killed).`;
    }

    if (outcome.exitCode === 0) return outcome.stdout || "(no output)";

    const parts = [`Error (exit ${outcome.exitCode})`];
    if (outcome.stdout) parts.push(`--- stdout ---\n${outcome.stdout}`);
    if (outcome.stderr) parts.push(`--- stderr ---\n${outcome.stderr}`);
    return parts.join("\n");
  } catch (err: unknown) {
    try { proc?.kill(); } catch { /* already dead */ }
    // Same rationale as the timeout branch: if proc.exited rejected or a reader
    // erred, the other reader may still be pending. Cancel both so their locks
    // release through collectCappedFromReader's finally.
    stdoutReader?.cancel().catch(() => { /* already done */ });
    stderrReader?.cancel().catch(() => { /* already done */ });
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    // Unconditionally clear the timer — on any success, error, or early return
    // path — so it doesn't fire later holding proc + reader closures.
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function collectCappedFromReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  capBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > capBytes) {
        truncated = true;
        // Keep draining to let the process exit cleanly — dropping content only.
        continue;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* already released or cancelled */ }
  }
  if (truncated) out += `\n\n…(output truncated at ${capBytes} bytes)`;
  return { text: out, truncated };
}

function createWebFetchBuiltin(runId: number): Record<string, BuiltinTool> {
  return {
    web_fetch: {
      tool: {
        type: "function",
        function: {
          name: "web_fetch",
          description:
            "Fetch a URL with a real headless browser (handles JavaScript and SPAs), extract the main content as Markdown, and save it to this run's attachments folder. Returns a short status with the saved filename — the page content does NOT come back inline. Use list_attachments to see saved files; read_attachment or grep_attachment to read them. Repeated calls for the same URL within a run reuse the first fetch's saved file.",
          parameters: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", description: "Absolute http(s) URL to fetch" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const url = String(args.url ?? "");
          if (!url) return "Error: url is required";
          const result = await webFetch(runId, url);
          return formatFetchResult(result);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error fetching URL: ${msg}`;
        }
      },
    },
  };
}
