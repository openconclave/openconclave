import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and its dependencies before importing the module under test
vi.mock("../db/client", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("./embeddings", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { cosineSimilarity, searchKnowledgeBase } from "../search";
import { db } from "../../db/client";
import { generateEmbedding } from "../embeddings";

// ── cosineSimilarity ──────────────────────────────────────────

describe("cosineSimilarity", () => {
  // ── Identical vectors ────────────────────────────────────────

  describe("identical vectors", () => {
    it("returns 1.0 for identical unit vectors", () => {
      const v = [1, 0, 0];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it("returns 1.0 for identical non-unit vectors", () => {
      const v = [3, 4, 0];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it("returns 1.0 for identical longer vectors", () => {
      const v = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });
  });

  // ── Orthogonal vectors ───────────────────────────────────────

  describe("orthogonal vectors", () => {
    it("returns 0.0 for orthogonal 2D vectors", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it("returns 0.0 for orthogonal 3D vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
    });

    it("returns 0.0 for orthogonal vectors in higher dimensions", () => {
      expect(cosineSimilarity([1, 0, 0, 0], [0, 0, 1, 0])).toBeCloseTo(0.0);
    });
  });

  // ── Opposite vectors ─────────────────────────────────────────

  describe("opposite vectors", () => {
    it("returns -1.0 for opposite unit vectors", () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });

    it("returns -1.0 for opposite non-unit vectors", () => {
      expect(cosineSimilarity([3, 4], [-3, -4])).toBeCloseTo(-1.0);
    });

    it("returns -1.0 for opposite vectors in 3D", () => {
      expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1.0);
    });
  });

  // ── Zero vector ──────────────────────────────────────────────

  describe("zero vectors", () => {
    it("returns 0 when first vector is all zeros", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it("returns 0 when second vector is all zeros", () => {
      expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    });

    it("returns 0 when both vectors are all zeros", () => {
      expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
    });
  });

  // ── Different length vectors ─────────────────────────────────

  describe("mismatched length vectors", () => {
    it("returns 0 when vectors have different lengths", () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    });

    it("returns 0 when first vector is empty and second is not", () => {
      expect(cosineSimilarity([], [1, 2, 3])).toBe(0);
    });

    it("returns 0 when second vector is empty and first is not", () => {
      expect(cosineSimilarity([1, 2, 3], [])).toBe(0);
    });
  });

  // ── Known similarity values ──────────────────────────────────

  describe("known similarity values", () => {
    it("returns ~0.707 for 45-degree 2D vectors", () => {
      // [1,0] and [1,1] → dot=1, |a|=1, |b|=sqrt(2) → 1/sqrt(2) ≈ 0.707
      expect(cosineSimilarity([1, 0], [1, 1])).toBeCloseTo(0.7071, 3);
    });

    it("returns ~0.974 for nearly parallel vectors", () => {
      // [1,0.1] and [1,0.2] should be close to 1 but not exactly
      const sim = cosineSimilarity([1, 0.1], [1, 0.2]);
      expect(sim).toBeGreaterThan(0.97);
      expect(sim).toBeLessThan(1.0);
    });

    it("result is symmetric: similarity(a,b) === similarity(b,a)", () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a));
    });

    it("similarity is always in range [-1, 1]", () => {
      const vectors = [
        [1, -2, 3],
        [-1, 0, 0.5],
        [0.1, 0.2, 0.3],
        [100, 200, 300],
      ];
      for (let i = 0; i < vectors.length; i++) {
        for (let j = 0; j < vectors.length; j++) {
          const sim = cosineSimilarity(vectors[i], vectors[j]);
          expect(sim).toBeGreaterThanOrEqual(-1.0 - 1e-9);
          expect(sim).toBeLessThanOrEqual(1.0 + 1e-9);
        }
      }
    });
  });
});

// ── searchKnowledgeBase ───────────────────────────────────────

describe("searchKnowledgeBase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build a fluent chain for db.select().from().where().get() — returns a single row.
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
   * Build a fluent chain for db.select().from().where() — returns an array (no .get()).
   * Drizzle returns a thenable array, so we make where() resolve as a promise.
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
   * Set up db.select() to return the given chains in sequence.
   */
  function setupSelectSequence(...chains: unknown[]) {
    const selectMock = db.select as ReturnType<typeof vi.fn>;
    for (const chain of chains) {
      selectMock.mockReturnValueOnce(chain);
    }
  }

  it("throws when knowledge base is not found", async () => {
    setupSelectSequence(makeSelectChain(null));

    await expect(searchKnowledgeBase(999, "query")).rejects.toThrow(
      "Knowledge base 999 not found",
    );
  });

  it("returns scored results sorted by score descending", async () => {
    const kb = {
      id: 1,
      name: "Test KB",
      embeddingModel: "nomic-embed-text",
    };
    const queryEmbedding = [1, 0, 0];

    const chunk1 = {
      id: 1,
      documentId: 10,
      content: "less relevant content",
      metadata: null,
      embedding: JSON.stringify([0, 1, 0]),
      chunkIndex: 0,
    };
    const chunk2 = {
      id: 2,
      documentId: 10,
      content: "most relevant content",
      metadata: null,
      embedding: JSON.stringify([1, 0, 0]),
      chunkIndex: 1,
    };
    const docs = [{ id: 10, filename: "doc.txt" }];

    setupSelectSequence(
      makeSelectChain(kb),
      makeSelectArrayChain([chunk1, chunk2]),
      makeSelectArrayChain(docs),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(queryEmbedding);

    const results = await searchKnowledgeBase(1, "query", 5);

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("most relevant content");
    expect(results[0].score).toBeCloseTo(1.0);
    expect(results[1].content).toBe("less relevant content");
    expect(results[1].score).toBeCloseTo(0.0);
  });

  it("returns only topK results", async () => {
    const kb = { id: 1, name: "KB", embeddingModel: "nomic-embed-text" };
    const queryEmbedding = [1, 0, 0];

    const chunkList = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      documentId: 1,
      content: `chunk ${i}`,
      metadata: null,
      embedding: JSON.stringify([Math.random(), Math.random(), Math.random()]),
      chunkIndex: i,
    }));

    const docs = [{ id: 1, filename: "file.txt" }];

    setupSelectSequence(
      makeSelectChain(kb),
      makeSelectArrayChain(chunkList),
      makeSelectArrayChain(docs),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(queryEmbedding);

    const results = await searchKnowledgeBase(1, "query", 3);

    expect(results).toHaveLength(3);
  });

  it("returns empty array when there are no chunks", async () => {
    const kb = { id: 1, name: "KB", embeddingModel: "nomic-embed-text" };

    setupSelectSequence(
      makeSelectChain(kb),
      makeSelectArrayChain([]),
      makeSelectArrayChain([]),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([1, 0, 0]);

    const results = await searchKnowledgeBase(1, "query", 5);

    expect(results).toEqual([]);
  });

  it("uses 'unknown' as documentName when doc is not found in map", async () => {
    const kb = { id: 1, name: "KB", embeddingModel: "nomic-embed-text" };
    const chunk = {
      id: 1,
      documentId: 999,
      content: "some content",
      metadata: null,
      embedding: JSON.stringify([1, 0, 0]),
      chunkIndex: 0,
    };

    setupSelectSequence(
      makeSelectChain(kb),
      makeSelectArrayChain([chunk]),
      makeSelectArrayChain([]),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([1, 0, 0]);

    const results = await searchKnowledgeBase(1, "query", 5);

    expect(results[0].documentName).toBe("unknown");
  });

  it("result shape matches KnowledgeSearchResult interface", async () => {
    const kb = { id: 1, name: "KB", embeddingModel: "nomic-embed-text" };
    const chunk = {
      id: 1,
      documentId: 10,
      content: "content here",
      metadata: JSON.stringify({ key: "val" }),
      embedding: JSON.stringify([1, 0]),
      chunkIndex: 2,
    };
    const docs = [{ id: 10, filename: "test.txt" }];

    setupSelectSequence(
      makeSelectChain(kb),
      makeSelectArrayChain([chunk]),
      makeSelectArrayChain(docs),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([1, 0]);

    const results = await searchKnowledgeBase(1, "query", 5);
    const r = results[0];

    expect(r).toHaveProperty("content");
    expect(r).toHaveProperty("score");
    expect(r).toHaveProperty("metadata");
    expect(r).toHaveProperty("documentName");
    expect(r).toHaveProperty("chunkIndex");
    expect(r.chunkIndex).toBe(2);
    expect(r.documentName).toBe("test.txt");
  });

  it("calls generateEmbedding with correct model and query", async () => {
    const kb = { id: 1, name: "KB", embeddingModel: "all-minilm" };

    setupSelectSequence(
      makeSelectChain(kb),
      makeSelectArrayChain([]),
      makeSelectArrayChain([]),
    );

    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([1, 0]);

    await searchKnowledgeBase(1, "find something", 5);

    expect(generateEmbedding).toHaveBeenCalledWith("all-minilm", "find something");
  });
});
