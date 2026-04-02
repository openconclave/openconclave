#!/usr/bin/env bun
/**
 * OpenConclave Workflow MCP Server
 *
 * Provides workflow-aware tools to agents running inside a workflow.
 * Each agent run gets its own instance with context about available
 * routes, conversation history, and workflow state.
 *
 * Communication: agent calls tools via MCP, server writes decisions
 * to a state file that the executor reads after agent completes.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { z } from "zod";

// Config passed via environment
const STATE_FILE = process.env.OC_STATE_FILE ?? "";
const ROUTE_TARGETS = JSON.parse(process.env.OC_ROUTE_TARGETS ?? "[]") as Array<{
  nodeId: string;
  label: string;
  type: string;
}>;
const CONVERSATION_HISTORY = JSON.parse(process.env.OC_CONVERSATION_HISTORY ?? "[]") as Array<{
  role: string;
  content: string;
}>;
const KNOWLEDGE_BASE_IDS = JSON.parse(process.env.OC_KNOWLEDGE_BASE_IDS ?? "[]") as number[];
const API_URL = process.env.OC_API_URL ?? "http://localhost:4000";

// State that gets written back to the executor
interface WorkflowState {
  routeTo?: string;
  routeContent?: string;
}

function writeState(state: WorkflowState) {
  if (STATE_FILE) {
    writeFileSync(STATE_FILE, JSON.stringify(state));
  }
}

// ── Server ───────────────────────────────────────────────────

const server = new McpServer({
  name: "openconclave-workflow",
  version: "0.1.0",
});

// ── Routing Tool ─────────────────────────────────────────────

if (ROUTE_TARGETS.length >= 2) {
  const validIds = ROUTE_TARGETS.map((t) => t.nodeId);
  const routeDescription = ROUTE_TARGETS
    .map((t) => {
      const desc = (t as Record<string, unknown>).description as string | undefined;
      return `  - "${t.nodeId}" → ${t.label} (${t.type})${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");

  server.tool(
    "openconclave_next",
    [
      "Choose the next step in the workflow. You MUST call this exactly once when you are done.",
      "Available routes:",
      routeDescription,
    ].join("\n"),
    {
      node_id: z.enum(validIds as [string, ...string[]]).describe("The ID of the next node to route to"),
      content: z.string().describe("Your output message to pass to the next node"),
    },
    async ({ node_id, content }) => {
      writeState({ routeTo: node_id, routeContent: content });
      const target = ROUTE_TARGETS.find((t) => t.nodeId === node_id);
      return {
        content: [{ type: "text", text: `Routing to: ${target?.label ?? node_id}` }],
      };
    }
  );
}

// ── Conversation History Tool ────────────────────────────────

if (CONVERSATION_HISTORY.length > 0) {
  server.tool(
    "openconclave_history",
    "Get the conversation history from previous turns in this workflow loop.",
    {},
    async () => {
      const formatted = CONVERSATION_HISTORY
        .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`)
        .join("\n\n");
      return {
        content: [{ type: "text", text: formatted }],
      };
    }
  );
}

// ── Knowledge Tools ──────────────────────────────────────────

if (KNOWLEDGE_BASE_IDS.length > 0) {
  const kbList = KNOWLEDGE_BASE_IDS.join(", ");

  server.tool(
    "knowledge_search",
    `Search connected knowledge bases (IDs: ${kbList}) using semantic similarity. Returns the most relevant text passages.`,
    {
      query: z.string().describe("The search query"),
      top_k: z.number().optional().describe("Number of results to return (default: 5)"),
      knowledge_base_id: z.number().optional().describe(`Specific KB to search. If omitted, searches all connected KBs (${kbList})`),
    },
    async ({ query, top_k, knowledge_base_id }) => {
      const topK = top_k ?? 5;
      const targetIds = knowledge_base_id !== undefined
        ? [knowledge_base_id]
        : KNOWLEDGE_BASE_IDS;

      // Verify the requested KB is in the allowed list
      if (knowledge_base_id !== undefined && !KNOWLEDGE_BASE_IDS.includes(knowledge_base_id)) {
        return { content: [{ type: "text" as const, text: `Error: knowledge base ${knowledge_base_id} is not connected to this agent. Available: ${kbList}` }] };
      }

      const allResults: Array<{ content: string; score: number; documentName: string; chunkIndex: number }> = [];

      for (const kbId of targetIds) {
        try {
          const res = await fetch(`${API_URL}/api/knowledge/${kbId}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, topK }),
          });
          if (!res.ok) continue;
          const json = await res.json() as { data: Array<{ content: string; score: number; documentName: string; chunkIndex: number }> };
          allResults.push(...json.data);
        } catch {
          // Skip unreachable KBs
        }
      }

      // Re-sort merged results
      allResults.sort((a, b) => b.score - a.score);
      const results = allResults.slice(0, topK);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No relevant results found." }] };
      }

      const formatted = results
        .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.documentName} chunk ${r.chunkIndex}]\n${r.content}`)
        .join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    }
  );

  server.tool(
    "knowledge_fetch",
    "Fetch full document content or specific chunks from a knowledge base. Use after searching to get complete context.",
    {
      knowledge_base_id: z.number().describe(`Knowledge base ID (available: ${kbList})`),
      document_id: z.number().describe("Document ID (from search results or document listing)"),
      chunk_index: z.number().optional().describe("Specific chunk index to fetch. If omitted, returns all chunks (full document)"),
    },
    async ({ knowledge_base_id, document_id, chunk_index }) => {
      if (!KNOWLEDGE_BASE_IDS.includes(knowledge_base_id)) {
        return { content: [{ type: "text" as const, text: `Error: knowledge base ${knowledge_base_id} is not connected to this agent. Available: ${kbList}` }] };
      }

      try {
        const res = await fetch(`${API_URL}/api/knowledge/${knowledge_base_id}/documents/${document_id}/chunks`);
        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Error fetching document: ${errText}` }] };
        }
        const json = await res.json() as {
          data: {
            document: { id: number; filename: string; sourcePath: string | null };
            chunks: Array<{ id: number; content: string; chunkIndex: number }>;
          };
        };

        const { document: doc, chunks: docChunks } = json.data;

        if (chunk_index !== undefined) {
          const chunk = docChunks.find((c) => c.chunkIndex === chunk_index);
          if (!chunk) {
            return { content: [{ type: "text" as const, text: `Chunk ${chunk_index} not found in document "${doc.filename}" (${docChunks.length} chunks available)` }] };
          }
          return {
            content: [{
              type: "text" as const,
              text: `Document: ${doc.filename}\nChunk ${chunk.chunkIndex}/${docChunks.length - 1}:\n\n${chunk.content}`,
            }],
          };
        }

        // Return full document (all chunks concatenated)
        const sorted = [...docChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
        const fullText = sorted.map((c) => c.content).join("\n\n");
        return {
          content: [{
            type: "text" as const,
            text: `Document: ${doc.filename} (${docChunks.length} chunks)\nSource: ${doc.sourcePath ?? "N/A"}\n\n${fullText}`,
          }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    }
  );

  server.tool(
    "knowledge_add",
    "Add new text content to a connected knowledge base. The text will be chunked and embedded automatically.",
    {
      knowledge_base_id: z.number().describe(`Knowledge base ID to add to (available: ${kbList})`),
      filename: z.string().describe("A descriptive filename for the content (e.g. 'meeting-notes-2024.txt')"),
      content: z.string().describe("The text content to ingest"),
    },
    async ({ knowledge_base_id, filename, content }) => {
      if (!KNOWLEDGE_BASE_IDS.includes(knowledge_base_id)) {
        return { content: [{ type: "text" as const, text: `Error: knowledge base ${knowledge_base_id} is not connected to this agent. Available: ${kbList}` }] };
      }

      try {
        const res = await fetch(`${API_URL}/api/knowledge/${knowledge_base_id}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: content, filename }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Error ingesting: ${errText}` }] };
        }

        const json = await res.json() as { data: { documentId: number } };
        return {
          content: [{
            type: "text" as const,
            text: `Successfully added "${filename}" to knowledge base ${knowledge_base_id}. Document ID: ${json.data.documentId}`,
          }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    }
  );
}

// ── Connect ──────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
