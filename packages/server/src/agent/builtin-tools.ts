import { spawn } from "bun";
import { logger } from "../lib/logger";
import type { Workspace } from "../engine/workspace";

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

export function createBuiltinTools(workspace?: Workspace): Record<string, BuiltinTool> {
  const resolvePath = (p: string) => workspace ? workspace.resolve(p) : p;
  return {
    bash: {
      tool: {
        type: "function",
        function: {
          name: "bash",
          description: "Run a shell command and return its output",
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
        try {
          const proc = spawn({
            cmd: ["bash", "-c", args.command as string],
            cwd: workspace?.cwd,
            stdout: "pipe",
            stderr: "pipe",
          });
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          return exitCode === 0
            ? stdout || "(no output)"
            : `Error (exit ${exitCode}): ${stderr || stdout}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
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
          const file = Bun.file(resolvePath(args.path as string));
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
          await Bun.write(resolvePath(args.path as string), args.content as string);
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
          const filePath = resolvePath(args.path as string);
          const oldStr = args.old_string as string;
          const newStr = args.new_string as string;
          const replaceAll = args.replace_all === true;

          const file = Bun.file(filePath);
          if (!(await file.exists())) {
            return `Error: file not found: ${args.path}`;
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
          const base = args.path
            ? resolvePath(args.path as string)
            : (workspace?.cwd ?? process.cwd());
          const glob = new Bun.Glob(pattern);
          const matches: string[] = [];
          const cap = 1000;
          for await (const file of glob.scan({ cwd: base, onlyFiles: true, dot: false })) {
            matches.push(file);
            if (matches.length > cap) break;
          }
          matches.sort();
          if (matches.length === 0) return `No files matching ${pattern} under ${base}`;
          if (matches.length > cap) {
            return `${cap}+ files matching ${pattern} (truncated):\n${matches.slice(0, cap).join("\n")}`;
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
            "Search file contents for a regex pattern (JavaScript flavor). Returns matches as 'path:line:content'. Searches the agent's working directory unless a path is given. Skips node_modules, .git, dist, build, .worktrees, and files over 2MB.",
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
          const baseDir = args.path
            ? resolvePath(args.path as string)
            : (workspace?.cwd ?? process.cwd());
          const fileGlob = (args.glob as string) ?? "**/*";
          const ignoreCase = args.ignore_case === true;
          const maxResults = (args.max_results as number | undefined) ?? 100;

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

          for await (const relPath of glob.scan({ cwd: baseDir, onlyFiles: true, dot: false })) {
            if (matches.length >= maxResults) break;
            if (relPath.split(/[\\/]/).some((seg) => skipDirs.has(seg))) continue;

            const absPath = `${baseDir.replace(/[\\/]$/, "")}/${relPath}`;
            try {
              const file = Bun.file(absPath);
              if (file.size > 2 * 1024 * 1024) continue;
              const text = await file.text();
              const lines = text.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= maxResults) break;
                const line = lines[i] ?? "";
                if (re.test(line)) {
                  const trimmed = line.trim().slice(0, 300);
                  matches.push(`${relPath}:${i + 1}:${trimmed}`);
                }
              }
            } catch {
              // skip unreadable files (binary, permissions)
            }
          }

          if (matches.length === 0) {
            return `No matches for /${pattern}/${ignoreCase ? "i" : ""} in ${baseDir}`;
          }
          const note = matches.length >= maxResults ? `\n(truncated at ${maxResults} matches)` : "";
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
            // Search all knowledge bases
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
};
