import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";

import { db } from "../db/client";
import { knowledgeBases, documents, chunks } from "../db/schema";
import { ingestText } from "../knowledge/ingest";
import { searchKnowledgeBase } from "../knowledge/search";
import { logger } from "../lib/logger";
import { AppError } from "@openconclave/shared";

export const knowledgeRoutes = new Hono()

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

    if (body.embeddingModel !== undefined && !/^\w[\w.:/-]{0,199}$/.test(String(body.embeddingModel))) {
      return c.json({ error: { code: "VALIDATION", message: "Invalid embeddingModel" } }, 400);
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

  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const existing = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    if (!existing) throw AppError.notFound("KnowledgeBase", String(id));

    // FK ordering: chunks → documents → KB
    db.transaction((tx) => {
      tx.delete(chunks).where(eq(chunks.knowledgeBaseId, id)).run();
      tx.delete(documents).where(eq(documents.knowledgeBaseId, id)).run();
      tx.delete(knowledgeBases).where(eq(knowledgeBases.id, id)).run();
    });

    logger.info(`Deleted knowledge base "${existing.name}"`, { id });
    return c.json({ data: { ok: true } });
  })

  .post("/:id/ingest", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      text?: string;
      filename?: string;
    };

    const kb = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    if (!kb) throw AppError.notFound("KnowledgeBase", String(id));

    if (typeof body.text === "string" && typeof body.filename === "string") {
      const documentId = await ingestText(id, body.filename, body.text);
      return c.json({ data: { documentId } }, 201);
    }

    return c.json(
      { error: { code: "VALIDATION", message: "Provide { text, filename }" } },
      400,
    );
  })

  .post("/:id/search", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      query?: string;
      topK?: number;
    };

    if (!body.query) {
      return c.json({ error: { code: "VALIDATION", message: "query is required" } }, 400);
    }

    const kb = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .get();

    if (!kb) throw AppError.notFound("KnowledgeBase", String(id));

    const topK = Math.max(1, Math.min(100, Math.floor(Number(body.topK) || 5)));
    const results = await searchKnowledgeBase(id, body.query, topK);
    return c.json({ data: results });
  })

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

    // FK ordering: chunks → document
    db.transaction((tx) => {
      tx.delete(chunks).where(eq(chunks.documentId, docId)).run();
      tx.delete(documents).where(eq(documents.id, docId)).run();
    });

    logger.info(`Deleted document "${doc.filename}"`, { docId, knowledgeBaseId: id });
    return c.json({ data: { ok: true } });
  });
