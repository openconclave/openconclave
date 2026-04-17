import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { RouteTarget } from "../../engine/types";
import { db } from "../../db/client";
import { documents, chunks } from "../../db/schema";
import { searchMultipleKBs } from "../../knowledge/search";
import { ingestText } from "../../knowledge/ingest";
import { registerPrompt } from "../../engine/prompt-registry";
import { broadcastRunEvent } from "../../ws/broadcast";
import { ROUTING_TOOL_NAME } from "../constants";

const ROUTE_CONTENT_MAX = 100_000;
const KB_FULL_DOC_CAP_CHARS = 200_000;

/** Routing decision state. The routing tool mutates this; the orchestrator
 *  reads it after the stream ends to build the final AgentResult. Returned
 *  by buildConclaveTools so ownership of the mutable ref is explicit. */
export interface RoutingState {
  routeTo?: string;
  routeContent?: string;
}

export interface BuildConclaveToolsOptions {
  routeTargets?: RouteTarget[];
  promptConfig?: { nodeId: string; runId: number; senderNode: string; description?: string };
  knowledgeBaseIds: number[];
  abortSignal?: AbortSignal;
}

export interface ConclaveToolsResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[];
  routingState: RoutingState;
}

export function buildConclaveTools(opts: BuildConclaveToolsOptions): ConclaveToolsResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [];
  const routingState: RoutingState = {};

  if (opts.routeTargets && opts.routeTargets.length >= 2) {
    tools.push(buildRoutingTool(opts.routeTargets, routingState));
  }
  if (opts.promptConfig) {
    tools.push(buildAskUserTool(opts.promptConfig, opts.abortSignal));
  }
  if (opts.knowledgeBaseIds.length > 0) {
    tools.push(
      buildKnowledgeSearchTool(opts.knowledgeBaseIds),
      buildKnowledgeFetchTool(opts.knowledgeBaseIds),
      buildKnowledgeAddTool(opts.knowledgeBaseIds),
    );
  }

  return { tools, routingState };
}

function buildRoutingTool(routeTargets: RouteTarget[], routingState: RoutingState) {
  const validIds = routeTargets.map((t) => t.nodeId) as [string, ...string[]];
  const routeDescription = routeTargets
    .map((t) => {
      const desc = t.description;
      return `  - "${t.nodeId}" → ${t.label} (${t.type})${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");

  return tool(
    ROUTING_TOOL_NAME,
    [
      "Choose the next step in the conclave.",
      "Available routes:",
      routeDescription,
    ].join("\n"),
    {
      node_id: z.enum(validIds).describe("The ID of the next node to route to"),
      content: z.string().max(ROUTE_CONTENT_MAX).describe("Your output message to pass to the next node"),
    },
    async ({ node_id, content }) => {
      if (routingState.routeTo) {
        return { content: [{ type: "text", text: `Error: route already set to ${routingState.routeTo} — cannot route twice.` }] };
      }
      routingState.routeTo = node_id;
      routingState.routeContent = content;
      // node_id is validated by z.enum(validIds), so target is always defined.
      const target = routeTargets.find((t) => t.nodeId === node_id)!;
      return {
        content: [{ type: "text", text: `Routing to: ${target.label}` }],
      };
    },
  );
}

function buildAskUserTool(
  promptConfig: { nodeId: string; runId: number; senderNode: string; description?: string },
  abortSignal: AbortSignal | undefined,
) {
  // Guard against the model parallelizing ask_user calls within one
  // assistant message. registerPrompt is keyed on (runId, nodeId), so a
  // second concurrent call would clobber the first pending resolver and
  // leave its promise hanging until the whole run aborts.
  let askInFlight = false;
  return tool(
    "ask_user",
    promptConfig.description ||
      "Ask the user a question and wait for their response. Use when you need clarification or more information.",
    {
      question: z.string().describe("The question to ask the user"),
    },
    async ({ question }) => {
      if (askInFlight) {
        return { content: [{ type: "text", text: "Error: ask_user is already pending — wait for the user's response before asking again." }] };
      }
      askInFlight = true;
      try {
        // Register the prompt resolver BEFORE broadcasting. Otherwise a
        // fast UI + fast user could post a response that arrives before
        // registerPrompt stashes the resolver, losing the response.
        const responsePromise = registerPrompt(
          promptConfig.runId,
          promptConfig.nodeId,
          question,
          null,
          abortSignal,
        );
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
        const response = await responsePromise;
        return { content: [{ type: "text", text: response }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error asking user: ${msg}` }] };
      } finally {
        askInFlight = false;
      }
    },
  );
}

function buildKnowledgeSearchTool(knowledgeBaseIds: number[]) {
  const kbList = knowledgeBaseIds.join(", ");
  return tool(
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
  );
}

function buildKnowledgeFetchTool(knowledgeBaseIds: number[]) {
  const kbList = knowledgeBaseIds.join(", ");
  return tool(
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
          .where(eq(chunks.documentId, document_id))
          .orderBy(chunks.chunkIndex);

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

        const fullText = docChunks.map((c) => c.content).join("\n\n");
        if (fullText.length > KB_FULL_DOC_CAP_CHARS) {
          const truncated = fullText.slice(0, KB_FULL_DOC_CAP_CHARS);
          return {
            content: [
              {
                type: "text",
                text: `Document: ${doc.filename} (${docChunks.length} chunks, truncated at ${KB_FULL_DOC_CAP_CHARS} chars — fetch individual chunks by chunk_index for more)\nSource: ${doc.sourcePath ?? "N/A"}\n\n${truncated}`,
              },
            ],
          };
        }
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
  );
}

function buildKnowledgeAddTool(knowledgeBaseIds: number[]) {
  const kbList = knowledgeBaseIds.join(", ");
  return tool(
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
  );
}
