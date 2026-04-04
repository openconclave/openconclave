import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { chunks, documents, knowledgeBases } from "../db/schema";
import { generateEmbedding } from "./embeddings";
import { logger } from "../lib/logger";
import type { KnowledgeSearchResult } from "@openconclave/shared";

/**
 * Pure JS cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Search a single knowledge base by semantic similarity.
 */
export async function searchKnowledgeBase(
  knowledgeBaseId: number,
  query: string,
  topK: number = 5,
): Promise<KnowledgeSearchResult[]> {
  // Get the KB to find its embedding model
  const kb = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, knowledgeBaseId))
    .get();

  if (!kb) {
    throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
  }

  logger.info(`Searching knowledge base "${kb.name}"`, { query: query.slice(0, 100), topK });

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(kb.embeddingModel, query);

  // Load all chunks for this KB
  const allChunks = await db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      metadata: chunks.metadata,
      embedding: chunks.embedding,
      chunkIndex: chunks.chunkIndex,
    })
    .from(chunks)
    .where(eq(chunks.knowledgeBaseId, knowledgeBaseId));

  // Build a map of document IDs to filenames
  const docs = await db
    .select({ id: documents.id, filename: documents.filename })
    .from(documents)
    .where(eq(documents.knowledgeBaseId, knowledgeBaseId));

  const docNameMap = new Map<number, string>();
  for (const doc of docs) {
    docNameMap.set(doc.id, doc.filename);
  }

  // Score each chunk
  const scored: KnowledgeSearchResult[] = [];

  for (const chunk of allChunks) {
    const chunkEmbedding = JSON.parse(chunk.embedding) as number[];
    const score = cosineSimilarity(queryEmbedding, chunkEmbedding);

    scored.push({
      content: chunk.content,
      score,
      metadata: (chunk.metadata ?? {}) as Record<string, unknown>,
      documentId: chunk.documentId,
      documentName: docNameMap.get(chunk.documentId) ?? "unknown",
      chunkIndex: chunk.chunkIndex,
    });
  }

  // Sort by score descending and return top K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Search across multiple knowledge bases and merge results.
 */
export async function searchMultipleKBs(
  kbIds: number[],
  query: string,
  topK: number = 5,
): Promise<KnowledgeSearchResult[]> {
  const allResults: KnowledgeSearchResult[] = [];

  for (const kbId of kbIds) {
    try {
      const results = await searchKnowledgeBase(kbId, query, topK);
      allResults.push(...results);
    } catch (err: unknown) {
      logger.warn(`Failed to search KB ${kbId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Re-sort merged results by score and return top K
  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, topK);
}
