import { readdirSync, statSync, existsSync } from "fs";
import { readFile } from "fs/promises";
import { join, basename } from "path";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { sessionDirForRun } from "../lib/workspace";
import type { BuiltinTool } from "./builtin-tools";

const MAX_READ_LINES = 2000;
const DEFAULT_READ_LINES = 500;
const MAX_GREP_HITS = 100;

function attachDir(runId: number): string {
  return join(sessionDirForRun(runId), "attachments");
}

function resolveAttachment(runId: number, filename: string): string {
  const safe = basename(filename);
  if (safe !== filename || safe.includes("..") || safe.length === 0) {
    throw new Error(`Invalid filename: ${filename}`);
  }
  const path = join(attachDir(runId), safe);
  if (!existsSync(path)) throw new Error(`Attachment not found: ${safe}`);
  return path;
}

export async function listAttachments(runId: number): Promise<string> {
  const dir = attachDir(runId);
  if (!existsSync(dir)) return "No attachments.";
  const entries = readdirSync(dir).flatMap((f) => {
    try {
      const st = statSync(join(dir, f));
      if (!st.isFile()) return [];
      return [{ name: f, size: st.size }];
    } catch {
      return [];
    }
  });
  if (entries.length === 0) return "No attachments.";
  return entries.map(({ name, size }) => `- ${name} (${size} bytes)`).join("\n");
}

export async function readAttachment(
  runId: number,
  filename: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const path = resolveAttachment(runId, filename);
  const cappedLimit = Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_READ_LINES)), MAX_READ_LINES);
  const start = Math.max(0, Math.floor(offset ?? 0));
  const text = await readFile(path, "utf-8");
  const all = text.split("\n");
  const total = all.length;
  const end = Math.min(total, start + cappedLimit);
  const slice = all.slice(start, end);
  if (slice.length === 0) return `[offset ${start} is past end (file has ${total} lines)]`;
  const hasMore = end < total;
  return `${slice.join("\n")}\n\n[lines ${start}-${end - 1} of ${total}${hasMore ? ", more available" : ""}]`;
}

export async function grepAttachment(
  runId: number,
  filename: string,
  pattern: string,
  flags?: string,
): Promise<string> {
  const path = resolveAttachment(runId, filename);
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags ?? "");
  } catch (err: unknown) {
    return `Invalid regex: ${err instanceof Error ? err.message : String(err)}`;
  }
  const text = await readFile(path, "utf-8");
  const lines = text.split("\n");
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) {
      hits.push(`${i}: ${lines[i]}`);
      if (hits.length >= MAX_GREP_HITS) break;
    }
  }
  if (hits.length === 0) return "No matches.";
  const truncated = hits.length >= MAX_GREP_HITS ? "\n\n[truncated — narrow the pattern]" : "";
  return hits.join("\n") + truncated;
}

const LIST_DESC = "List all files the user attached to this conversation. Returns filename and size in bytes. Call this first when the user mentions an attachment or asks about a file, then use read_attachment or grep_attachment to access contents.";
const READ_DESC = "Read a window of lines from an attached file. Use offset/limit to page through large files. Default reads first 500 lines; hard cap is 2000 lines per call. Call list_attachments first to get filenames.";
const GREP_DESC = "Search an attached file for a JavaScript regex pattern. Returns up to 100 matching lines with 0-indexed line numbers. Use this to locate relevant sections in large files before calling read_attachment.";

export function createAttachmentBuiltinTools(runId: number): Record<string, BuiltinTool> {
  return {
    list_attachments: {
      tool: {
        type: "function",
        function: {
          name: "list_attachments",
          description: LIST_DESC,
          parameters: { type: "object", properties: {} },
        },
      },
      execute: async () => {
        try {
          return await listAttachments(runId);
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    read_attachment: {
      tool: {
        type: "function",
        function: {
          name: "read_attachment",
          description: READ_DESC,
          parameters: {
            type: "object",
            required: ["filename"],
            properties: {
              filename: { type: "string", description: "Filename exactly as returned by list_attachments" },
              offset: { type: "integer", description: "0-indexed starting line (default 0)" },
              limit: { type: "integer", description: "Max lines to return (default 500, max 2000)" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          return await readAttachment(
            runId,
            args.filename as string,
            args.offset as number | undefined,
            args.limit as number | undefined,
          );
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    grep_attachment: {
      tool: {
        type: "function",
        function: {
          name: "grep_attachment",
          description: GREP_DESC,
          parameters: {
            type: "object",
            required: ["filename", "pattern"],
            properties: {
              filename: { type: "string", description: "Filename exactly as returned by list_attachments" },
              pattern: { type: "string", description: "JavaScript regex" },
              flags: { type: "string", description: "Optional regex flags (e.g. 'i' for case-insensitive)" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          return await grepAttachment(
            runId,
            args.filename as string,
            args.pattern as string,
            args.flags as string | undefined,
          );
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClaudeAttachmentTools(runId: number): any[] {
  return [
    tool(
      "list_attachments",
      LIST_DESC,
      {},
      async () => ({ content: [{ type: "text" as const, text: await listAttachments(runId) }] }),
    ),
    tool(
      "read_attachment",
      READ_DESC,
      {
        filename: z.string().describe("Filename exactly as returned by list_attachments"),
        offset: z.number().int().optional().describe("0-indexed starting line (default 0)"),
        limit: z.number().int().optional().describe("Max lines to return (default 500, max 2000)"),
      },
      async ({ filename, offset, limit }) => ({
        content: [{ type: "text" as const, text: await readAttachment(runId, filename, offset, limit) }],
      }),
    ),
    tool(
      "grep_attachment",
      GREP_DESC,
      {
        filename: z.string().describe("Filename exactly as returned by list_attachments"),
        pattern: z.string().describe("JavaScript regex"),
        flags: z.string().optional().describe("Optional regex flags (e.g. 'i' for case-insensitive)"),
      },
      async ({ filename, pattern, flags }) => ({
        content: [{ type: "text" as const, text: await grepAttachment(runId, filename, pattern, flags) }],
      }),
    ),
  ];
}
