import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock DB before importing anything that uses it
vi.mock("../db/client", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock knowledge modules to isolate route logic
vi.mock("../knowledge/ingest", () => ({
  ingestText: vi.fn(),
  ingestFile: vi.fn(),
}));

vi.mock("../knowledge/search", () => ({
  searchKnowledgeBase: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { db } from "../db/client";
import { knowledgeRoutes } from "./knowledge";
import { AppError } from "@openconclave/shared";

// ── Test app setup ────────────────────────────────────────────
// Wrap routes in a small Hono app that uses app.onError() so that
// AppError thrown from route handlers is converted to structured
// { error: { code, message } } JSON responses.

function createTestApp() {
  const app = new Hono();
  app.route("/api/knowledge", knowledgeRoutes);
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(err.toJSON(), err.statusCode as 400 | 404 | 500);
    }
    return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
  });
  return app;
}

// ── DB chain helpers ──────────────────────────────────────────

/**
 * db.select().from().where().get() — returns a single row (or null).
 */
function makeSelectChain(returnValue: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    get: vi.fn().mockReturnValue(returnValue),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

/**
 * db.select({ ... }).from().where() — returns an array (no .get()).
 */
function makeSelectArrayChain(returnValue: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(Promise.resolve(returnValue));
  return chain;
}

/**
 * db.select(fields).from().where() — shaped field selection returning an array.
 * Used for the chunks query that does db.select({ id, content, ... }).from(chunks).where(...)
 */
function makeSelectFieldsArrayChain(returnValue: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(Promise.resolve(returnValue));
  return chain;
}

// ── GET /:id/documents/:docId/chunks ─────────────────────────

describe("GET /api/knowledge/:id/documents/:docId/chunks", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ── Happy path ──────────────────────────────────────────────

  describe("happy path", () => {
    it("returns document info and chunks for a valid document belonging to the KB", async () => {
      const mockDoc = {
        id: 5,
        knowledgeBaseId: 1,
        filename: "guide.txt",
        sourcePath: "/docs/guide.txt",
        contentHash: "abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockChunks = [
        { id: 10, content: "First chunk content", chunkIndex: 0, metadata: null },
        { id: 11, content: "Second chunk content", chunkIndex: 1, metadata: { page: 2 } },
      ];

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain(mockChunks));

      const res = await app.request("/api/knowledge/1/documents/5/chunks");
      const body = await res.json() as { data: { document: unknown; chunks: unknown[] } };

      expect(res.status).toBe(200);
      expect(body.data).toBeDefined();
      expect(body.data.document).toEqual({
        id: 5,
        filename: "guide.txt",
        sourcePath: "/docs/guide.txt",
      });
      expect(body.data.chunks).toHaveLength(2);
    });

    it("includes chunk id, content, chunkIndex, and metadata in each chunk", async () => {
      const mockDoc = { id: 3, knowledgeBaseId: 2, filename: "notes.txt", sourcePath: null, contentHash: "xyz", createdAt: "2024-01-01T00:00:00.000Z" };
      const mockChunks = [
        { id: 20, content: "Some text", chunkIndex: 0, metadata: { source: "page1" } },
      ];

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain(mockChunks));

      const res = await app.request("/api/knowledge/2/documents/3/chunks");
      const body = await res.json() as { data: { chunks: Array<{ id: number; content: string; chunkIndex: number; metadata: unknown }> } };

      expect(res.status).toBe(200);
      const chunk = body.data.chunks[0];
      expect(chunk.id).toBe(20);
      expect(chunk.content).toBe("Some text");
      expect(chunk.chunkIndex).toBe(0);
      expect(chunk.metadata).toEqual({ source: "page1" });
    });

    it("returns an empty chunks array when document has no chunks", async () => {
      const mockDoc = { id: 7, knowledgeBaseId: 1, filename: "empty.txt", sourcePath: null, contentHash: "zzz", createdAt: "2024-01-01T00:00:00.000Z" };

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain([]));

      const res = await app.request("/api/knowledge/1/documents/7/chunks");
      const body = await res.json() as { data: { chunks: unknown[] } };

      expect(res.status).toBe(200);
      expect(body.data.chunks).toEqual([]);
    });

    it("response document object only includes id, filename, and sourcePath (no contentHash, createdAt)", async () => {
      const mockDoc = {
        id: 9,
        knowledgeBaseId: 4,
        filename: "report.pdf",
        sourcePath: "/reports/report.pdf",
        contentHash: "should-not-appear",
        createdAt: "should-not-appear",
      };

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain([]));

      const res = await app.request("/api/knowledge/4/documents/9/chunks");
      const body = await res.json() as { data: { document: Record<string, unknown> } };

      expect(res.status).toBe(200);
      expect(Object.keys(body.data.document)).toEqual(
        expect.arrayContaining(["id", "filename", "sourcePath"]),
      );
      expect(body.data.document).not.toHaveProperty("contentHash");
      expect(body.data.document).not.toHaveProperty("createdAt");
    });

    it("works when sourcePath is null", async () => {
      const mockDoc = { id: 2, knowledgeBaseId: 1, filename: "plain.txt", sourcePath: null, contentHash: "abc", createdAt: "2024-01-01T00:00:00.000Z" };

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain([]));

      const res = await app.request("/api/knowledge/1/documents/2/chunks");
      const body = await res.json() as { data: { document: { sourcePath: unknown } } };

      expect(res.status).toBe(200);
      expect(body.data.document.sourcePath).toBeNull();
    });

    it("returns multiple chunks in the order returned by the DB", async () => {
      const mockDoc = { id: 1, knowledgeBaseId: 1, filename: "multi.txt", sourcePath: null, contentHash: "abc", createdAt: "2024-01-01T00:00:00.000Z" };
      const mockChunks = [
        { id: 100, content: "Chunk 0", chunkIndex: 0, metadata: null },
        { id: 101, content: "Chunk 1", chunkIndex: 1, metadata: null },
        { id: 102, content: "Chunk 2", chunkIndex: 2, metadata: null },
      ];

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain(mockChunks));

      const res = await app.request("/api/knowledge/1/documents/1/chunks");
      const body = await res.json() as { data: { chunks: Array<{ chunkIndex: number }> } };

      expect(res.status).toBe(200);
      expect(body.data.chunks[0].chunkIndex).toBe(0);
      expect(body.data.chunks[1].chunkIndex).toBe(1);
      expect(body.data.chunks[2].chunkIndex).toBe(2);
    });
  });

  // ── 404 for nonexistent document ────────────────────────────

  describe("404 for nonexistent document", () => {
    it("returns 404 when the document does not exist", async () => {
      (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(null));

      const res = await app.request("/api/knowledge/1/documents/999/chunks");
      const body = await res.json() as { error: { code: string; message: string } };

      expect(res.status).toBe(404);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("error message mentions the document ID", async () => {
      (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(null));

      const res = await app.request("/api/knowledge/1/documents/42/chunks");
      const body = await res.json() as { error: { message: string } };

      expect(res.status).toBe(404);
      expect(body.error.message).toContain("42");
    });

    it("returns 404 error shape with error.code and error.message fields", async () => {
      (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(null));

      const res = await app.request("/api/knowledge/1/documents/0/chunks");
      const body = await res.json() as Record<string, unknown>;

      expect(res.status).toBe(404);
      expect(body).toHaveProperty("error");
      const err = body.error as Record<string, unknown>;
      expect(err).toHaveProperty("code");
      expect(err).toHaveProperty("message");
    });
  });

  // ── 404 when doc belongs to a different KB ───────────────────

  describe("404 when document does not belong to the KB", () => {
    it("returns 404 when document exists but belongs to a different KB", async () => {
      // Document belongs to KB 99, but request is for KB 1
      const mockDoc = {
        id: 5,
        knowledgeBaseId: 99,
        filename: "foreign.txt",
        sourcePath: null,
        contentHash: "abc",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(mockDoc));

      const res = await app.request("/api/knowledge/1/documents/5/chunks");
      const body = await res.json() as { error: { code: string } };

      expect(res.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("does not return chunk data when the document is from another KB", async () => {
      const mockDoc = { id: 5, knowledgeBaseId: 99, filename: "x.txt", sourcePath: null, contentHash: "x", createdAt: "" };

      (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(mockDoc));

      const res = await app.request("/api/knowledge/1/documents/5/chunks");
      const body = await res.json() as Record<string, unknown>;

      expect(res.status).toBe(404);
      expect(body).not.toHaveProperty("data");
    });

    it("returns 404 not 403 — mismatched KB is treated as not found", async () => {
      const mockDoc = { id: 5, knowledgeBaseId: 2, filename: "x.txt", sourcePath: null, contentHash: "x", createdAt: "" };

      (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(mockDoc));

      const res = await app.request("/api/knowledge/5/documents/5/chunks");
      expect(res.status).toBe(404);
    });

    it("does not query chunks when document belongs to wrong KB", async () => {
      const mockDoc = { id: 5, knowledgeBaseId: 99, filename: "x.txt", sourcePath: null, contentHash: "x", createdAt: "" };

      (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(mockDoc));

      await app.request("/api/knowledge/1/documents/5/chunks");

      // select should have been called only once (for the document lookup)
      expect(db.select).toHaveBeenCalledTimes(1);
    });
  });

  // ── Response shape ───────────────────────────────────────────

  describe("response shape", () => {
    it("success response is wrapped in { data } envelope", async () => {
      const mockDoc = { id: 1, knowledgeBaseId: 1, filename: "a.txt", sourcePath: null, contentHash: "x", createdAt: "" };

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain([]));

      const res = await app.request("/api/knowledge/1/documents/1/chunks");
      const body = await res.json() as Record<string, unknown>;

      expect(body).toHaveProperty("data");
      expect(body).not.toHaveProperty("error");
    });

    it("data object contains both document and chunks keys", async () => {
      const mockDoc = { id: 1, knowledgeBaseId: 1, filename: "a.txt", sourcePath: null, contentHash: "x", createdAt: "" };

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain([]));

      const res = await app.request("/api/knowledge/1/documents/1/chunks");
      const body = await res.json() as { data: Record<string, unknown> };

      expect(body.data).toHaveProperty("document");
      expect(body.data).toHaveProperty("chunks");
    });

    it("chunks is always an array", async () => {
      const mockDoc = { id: 1, knowledgeBaseId: 1, filename: "a.txt", sourcePath: null, contentHash: "x", createdAt: "" };

      (db.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeSelectChain(mockDoc))
        .mockReturnValueOnce(makeSelectFieldsArrayChain([]));

      const res = await app.request("/api/knowledge/1/documents/1/chunks");
      const body = await res.json() as { data: { chunks: unknown } };

      expect(Array.isArray(body.data.chunks)).toBe(true);
    });
  });
});
