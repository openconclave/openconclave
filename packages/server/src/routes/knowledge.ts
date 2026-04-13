import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";

import { db } from "../db/client";
import { knowledgeBases, documents, chunks } from "../db/schema";
import { ingestText, ingestFile } from "../knowledge/ingest";
import { searchKnowledgeBase } from "../knowledge/search";
import { logger } from "../lib/logger";
import { AppError } from "@openconclave/shared";

export const knowledgeRoutes = new Hono()

  // ── List all knowledge bases (with doc/chunk counts) ──────
  .get("/", async (c) => {
    const kbs = await db.select().from(knowledgeBases);

    const result = await Promise.all(
      kbs.map(async (kb) => {
        const docCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(documents)
          .where(eq(documents.knowledgeBaseId, kb.id))
          .get();

        const chunkCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(chunks)
          .where(eq(chunks.knowledgeBaseId, kb.id))
          .get();

        return {
          ...kb,
          documentCount: docCount?.count ?? 0,
          chunkCount: chunkCount?.count ?? 0,
        };
      }),
    );

    return c.json({ data: result });
  })

  // ── Create knowledge base ─────────────────────────────────
  .post("/", async (c) => {
    const body = (await c.req.json()) as {
      name?: string;
      description?: string;
      embeddingModel?: string;
      chunkSize?: number;
      chunkOverlap?: number;
    };

    if (!body.name) {
      return c.json({ error: { code: "VALIDATION", message: "name is required" } }, 400);
    }

    const now = new Date().toISOString();
    const result = await db
      .insert(knowledgeBases)
      .values({
        name: body.name,
        description: body.description ?? null,
        embeddingModel: body.embeddingModel ?? "nomic-embed-text",
        chunkSize: body.chunkSize ?? 512,
        chunkOverlap: body.chunkOverlap ?? 50,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info(`Created knowledge base "${body.name}"`, { id: result[0]!.id });
    return c.json({ data: result[0]! }, 201);
  })

  // ── Get knowledge base details ────────────────────────────
  .get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const kb = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    if (!kb) throw AppError.notFound("KnowledgeBase", String(id));

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.knowledgeBaseId, id));

    const chunkCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(chunks)
      .where(eq(chunks.knowledgeBaseId, id))
      .get();

    return c.json({
      data: {
        ...kb,
        documentCount: docs.length,
        chunkCount: chunkCount?.count ?? 0,
        documents: docs,
      },
    });
  })

  // ── Update knowledge base ─────────────────────────────────
  .put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      name?: string;
      description?: string;
    };

    const existing = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    if (!existing) throw AppError.notFound("KnowledgeBase", String(id));

    const now = new Date().toISOString();
    await db
      .update(knowledgeBases)
      .set({
        name: body.name ?? existing.name,
        description: body.description !== undefined ? body.description : existing.description,
        updatedAt: now,
      })
      .where(eq(knowledgeBases.id, id));

    const updated = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    return c.json({ data: updated });
  })

  // ── Delete knowledge base (cascade) ───────────────────────
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const existing = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    if (!existing) throw AppError.notFound("KnowledgeBase", String(id));

    // Delete chunks first (FK), then documents, then KB
    await db.delete(chunks).where(eq(chunks.knowledgeBaseId, id));
    await db.delete(documents).where(eq(documents.knowledgeBaseId, id));
    await db.delete(knowledgeBases).where(eq(knowledgeBases.id, id));

    logger.info(`Deleted knowledge base "${existing.name}"`, { id });
    return c.json({ data: { ok: true } });
  })

  // ── Ingest text or file ───────────────────────────────────
  .post("/:id/ingest", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      text?: string;
      filename?: string;
      filePath?: string;
    };

    let documentId: number;

    if (body.filePath) {
      documentId = await ingestFile(id, body.filePath);
    } else if (body.text && body.filename) {
      documentId = await ingestText(id, body.filename, body.text);
    } else {
      return c.json(
        { error: { code: "VALIDATION", message: "Provide { text, filename } or { filePath }" } },
        400,
      );
    }

    return c.json({ data: { documentId } }, 201);
  })

  // ── Search knowledge base ─────────────────────────────────
  .post("/:id/search", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      query?: string;
      topK?: number;
    };

    if (!body.query) {
      return c.json({ error: { code: "VALIDATION", message: "query is required" } }, 400);
    }

    const results = await searchKnowledgeBase(id, body.query, body.topK ?? 5);
    return c.json({ data: results });
  })

  // ── List documents in KB ──────────────────────────────────
  .get("/:id/documents", async (c) => {
    const id = Number(c.req.param("id"));

    const kb = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    if (!kb) throw AppError.notFound("KnowledgeBase", String(id));

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.knowledgeBaseId, id));

    // Add chunk counts per document
    const result = await Promise.all(
      docs.map(async (doc) => {
        const chunkCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(chunks)
          .where(eq(chunks.documentId, doc.id))
          .get();

        return {
          ...doc,
          chunkCount: chunkCount?.count ?? 0,
        };
      }),
    );

    return c.json({ data: result });
  })

  // ── Get single document (with content) ─────────────────────
  .get("/:id/documents/:docId", async (c) => {
    const id = Number(c.req.param("id"));
    const docId = Number(c.req.param("docId"));

    const doc = await db
      .select()
      .from(documents)
      .where(eq(documents.id, docId))
      .get();

    if (!doc || doc.knowledgeBaseId !== id) {
      throw AppError.notFound("Document", String(docId));
    }

    const chunkCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(chunks)
      .where(eq(chunks.documentId, docId))
      .get();

    return c.json({
      data: {
        ...doc,
        chunkCount: chunkCount?.count ?? 0,
      },
    });
  })

  // ── Get document chunks ────────────────────────────────────
  .get("/:id/documents/:docId/chunks", async (c) => {
    const id = Number(c.req.param("id"));
    const docId = Number(c.req.param("docId"));

    const doc = await db
      .select()
      .from(documents)
      .where(eq(documents.id, docId))
      .get();

    if (!doc || doc.knowledgeBaseId !== id) {
      throw AppError.notFound("Document", String(docId));
    }

    const docChunks = await db
      .select({
        id: chunks.id,
        content: chunks.content,
        chunkIndex: chunks.chunkIndex,
        metadata: chunks.metadata,
      })
      .from(chunks)
      .where(eq(chunks.documentId, docId));

    return c.json({
      data: {
        document: { id: doc.id, filename: doc.filename, sourcePath: doc.sourcePath },
        chunks: docChunks,
      },
    });
  })

  // ── Delete document (cascade chunks) ──────────────────────
  .delete("/:id/documents/:docId", async (c) => {
    const id = Number(c.req.param("id"));
    const docId = Number(c.req.param("docId"));

    const doc = await db
      .select()
      .from(documents)
      .where(eq(documents.id, docId))
      .get();

    if (!doc || doc.knowledgeBaseId !== id) {
      throw AppError.notFound("Document", String(docId));
    }

    await db.delete(chunks).where(eq(chunks.documentId, docId));
    await db.delete(documents).where(eq(documents.id, docId));

    logger.info(`Deleted document "${doc.filename}"`, { docId, knowledgeBaseId: id });
    return c.json({ data: { ok: true } });
  });
