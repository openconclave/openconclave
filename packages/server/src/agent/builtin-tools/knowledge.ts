import { logger } from "../../lib/logger";
import type { BuiltinTool } from "./types";

// Full-document knowledge fetches can blow the model's context. Cap conservatively
// and instruct the agent to fetch specific chunks if they need more.
const KB_FULL_DOC_CAP_CHARS = 200_000;

export function buildKnowledgeTools(): Record<string, BuiltinTool> {
  return {
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
            "../../knowledge/search"
          );
          const query = args.query as string;
          const topK = (args.top_k as number | undefined) ?? 5;
          const kbId = args.knowledge_base_id as number | undefined;

          let results;
          if (kbId !== undefined) {
            results = await searchKnowledgeBase(kbId, query, topK);
          } else {
            const { db: dbClient } = await import("../../db/client");
            const { knowledgeBases: kbTable } = await import("../../db/schema");
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
          const { db: dbClient } = await import("../../db/client");
          const { documents: docsTable, chunks: chunksTable } = await import("../../db/schema");
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
          const { ingestText } = await import("../../knowledge/ingest");
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
