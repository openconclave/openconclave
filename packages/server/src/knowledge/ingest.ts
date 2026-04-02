import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { documents, chunks, knowledgeBases } from "../db/schema";
import { chunkText } from "./chunker";
import { generateEmbeddings } from "./embeddings";
import { logger } from "../lib/logger";

/**
 * Compute a hex content hash using Web Crypto API (available in Bun).
 */
async function contentHash(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Ingest raw text into a knowledge base.
 * Returns the document ID (or existing document ID if content hash matches).
 */
export async function ingestText(
  knowledgeBaseId: number,
  filename: string,
  text: string,
  sourcePath?: string,
): Promise<number> {
  // Get the KB config
  const kb = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, knowledgeBaseId))
    .get();

  if (!kb) {
    throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
  }

  // Compute content hash
  const hash = await contentHash(text);

  // Check for existing document with same hash in this KB
  const existing = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.knowledgeBaseId, knowledgeBaseId),
        eq(documents.contentHash, hash),
      ),
    )
    .get();

  if (existing) {
    logger.info(`Document "${filename}" already ingested (hash match)`, {
      documentId: existing.id,
    });
    return existing.id;
  }

  logger.info(`Ingesting "${filename}" into knowledge base "${kb.name}"`, {
    knowledgeBaseId,
    textLength: text.length,
  });

  // Chunk the text
  const textChunks = chunkText(text, kb.chunkSize, kb.chunkOverlap);
  logger.info(`Split into ${textChunks.length} chunks`, { chunkSize: kb.chunkSize });

  // Generate embeddings for all chunks
  const embeddings = await generateEmbeddings(kb.embeddingModel, textChunks);

  // Insert document
  const now = new Date().toISOString();
  const docResult = await db
    .insert(documents)
    .values({
      knowledgeBaseId,
      filename,
      sourcePath: sourcePath ?? null,
      content: text,
      contentHash: hash,
      createdAt: now,
    })
    .returning({ id: documents.id });

  const documentId = docResult[0].id;

  // Insert chunks with embeddings
  for (let i = 0; i < textChunks.length; i++) {
    await db.insert(chunks).values({
      documentId,
      knowledgeBaseId,
      content: textChunks[i],
      metadata: { chunkIndex: i, filename } as Record<string, unknown>,
      embedding: JSON.stringify(embeddings[i]),
      chunkIndex: i,
    });
  }

  logger.info(`Ingestion complete for "${filename}"`, {
    documentId,
    chunkCount: textChunks.length,
  });

  return documentId;
}

/**
 * Ingest a file from disk into a knowledge base.
 */
export async function ingestFile(
  knowledgeBaseId: number,
  filePath: string,
): Promise<number> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`File not found: ${filePath}`);
  }

  const text = await file.text();
  const filename = filePath.split(/[/\\]/).pop() ?? filePath;

  return ingestText(knowledgeBaseId, filename, text, filePath);
}
