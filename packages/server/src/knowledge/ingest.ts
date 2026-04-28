import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { documents, chunks, knowledgeBases } from "../db/schema";
import { chunkText } from "./chunker";
import { generateEmbeddings } from "./embeddings";
import { AppError } from "@openconclave/shared";
import { logger } from "../lib/logger";

async function contentHash(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Returns the existing document ID if content was already ingested; otherwise inserts and returns the new ID. */
export async function ingestText(
  knowledgeBaseId: number,
  filename: string,
  text: string,
  sourcePath?: string,
): Promise<number> {
  const kb = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, knowledgeBaseId))
    .get();

  if (!kb) {
    throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
  }

  const hash = await contentHash(text);
  const textChunks = chunkText(text, kb.chunkSize, kb.chunkOverlap);

  if (textChunks.length === 0) {
    throw AppError.validation("text produces no content after chunking");
  }

  logger.info(`Ingesting "${filename}" into knowledge base "${kb.name}"`, {
    knowledgeBaseId,
    textLength: text.length,
  });
  logger.info(`Split into ${textChunks.length} chunks`, { chunkSize: kb.chunkSize });

  const embeddings = await generateEmbeddings(kb.embeddingModel, textChunks);

  const now = new Date().toISOString();
  const documentId = db.transaction((tx) => {
    const inserted = tx
      .insert(documents)
      .values({
        knowledgeBaseId,
        filename,
        sourcePath: sourcePath ?? null,
        content: text,
        contentHash: hash,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: documents.id })
      .get();

    if (inserted) {
      for (let i = 0; i < textChunks.length; i++) {
        tx.insert(chunks).values({
          documentId: inserted.id,
          knowledgeBaseId,
          content: textChunks[i]!,
          metadata: { chunkIndex: i, filename },
          embedding: JSON.stringify(embeddings[i]!),
          chunkIndex: i,
        }).run();
      }
      logger.info(`Ingestion complete for "${filename}"`, {
        documentId: inserted.id,
        chunkCount: textChunks.length,
      });
      return inserted.id;
    }

    const existing = tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.knowledgeBaseId, knowledgeBaseId),
          eq(documents.contentHash, hash),
        ),
      )
      .get();

    logger.info(`Document "${filename}" already ingested (hash match)`, {
      documentId: existing!.id,
    });
    return existing!.id;
  });

  return documentId;
}
