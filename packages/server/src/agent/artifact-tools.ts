import { writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { sessionDirForRun } from "../lib/workspace";
import { broadcastRunEvent } from "../ws/broadcast";
import type { BuiltinTool } from "./builtin-tools";

function artifactDir(runId: number): string {
  return join(sessionDirForRun(runId), "artifacts");
}

function resolveArtifactPath(runId: number, filename: string): string {
  const safe = basename(String(filename));
  if (safe !== String(filename) || safe.includes("..") || safe.length === 0) {
    throw new Error(`Invalid filename: ${filename}`);
  }
  return join(artifactDir(runId), safe);
}

export type ArtifactInfo = { filename: string; path: string; size: number; createdAt: string };

export function listArtifacts(runId: number): ArtifactInfo[] {
  const dir = artifactDir(runId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => {
      try { return statSync(join(dir, f)).isFile(); } catch { return false; }
    })
    .map((filename) => {
      const path = join(dir, filename);
      const st = statSync(path);
      return {
        filename,
        path,
        size: st.size,
        createdAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function createArtifact(runId: number, filename: string, content: string): Promise<string> {
  const path = resolveArtifactPath(runId, filename);
  writeFileSync(path, content, "utf-8");
  const size = Buffer.byteLength(content, "utf-8");
  const st = statSync(path);
  broadcastRunEvent({
    type: "artifact:created",
    runId,
    data: { filename: basename(path), path, size, createdAt: st.mtime.toISOString() },
  });
  return `Saved: ${path} (${size} bytes)`;
}

const CREATE_DESC = "Save a deliverable output from this run (report, summary, generated file, etc.) so the user can view or open it. Files land in the run's artifacts folder and are surfaced in the UI. Pass filename and text content. Overwrites if filename already exists.";

export function createArtifactBuiltinTools(runId: number): Record<string, BuiltinTool> {
  return {
    create_artifact: {
      tool: {
        type: "function",
        function: {
          name: "create_artifact",
          description: CREATE_DESC,
          parameters: {
            type: "object",
            required: ["filename", "content"],
            properties: {
              filename: { type: "string", description: "Name of the file to create (e.g. 'summary.md'). Path components are stripped for safety." },
              content: { type: "string", description: "Full text content of the file." },
            },
          },
        },
      },
      execute: async (args) => createArtifact(
        runId,
        args.filename as string,
        args.content as string,
      ),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClaudeArtifactTools(runId: number): any[] {
  return [
    tool(
      "create_artifact",
      CREATE_DESC,
      {
        filename: z.string().describe("Name of the file to create (e.g. 'summary.md'). Path components are stripped for safety."),
        content: z.string().describe("Full text content of the file."),
      },
      async ({ filename, content }) => ({
        content: [{ type: "text" as const, text: await createArtifact(runId, filename, content) }],
      }),
    ),
  ];
}
