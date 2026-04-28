import { test, expect, describe, mock, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

// TEST_LIMITATION: true OS-thread concurrency can't be reproduced in the
// single-threaded JS event loop. The Finding 3 race is reproduced by delaying
// generateEmbeddings so both calls complete their racy SELECT before either
// INSERT commits — same sequence that concurrent callers would observe.

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA foreign_keys = OFF");
sqlite.exec(`CREATE TABLE knowledge_bases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  embedding_model TEXT NOT NULL DEFAULT 'nomic-embed-text',
  chunk_size INTEGER NOT NULL DEFAULT 512,
  chunk_overlap INTEGER NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);
sqlite.exec(`CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_base_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  source_path TEXT,
  content TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);
// unique index required by Finding 3 fix — must be present to drive pre-fix UNIQUE violation
sqlite.exec(
  `CREATE UNIQUE INDEX idx_documents_kb_hash ON documents(knowledge_base_id, content_hash)`,
);
sqlite.exec(`CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  knowledge_base_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  embedding TEXT NOT NULL,
  chunk_index INTEGER NOT NULL
)`);

const testDb = drizzle(sqlite);
mock.module("../../db/client", () => ({ db: testDb }));

// Shared flag: set true in Finding 3's test so both concurrent calls reach their
// INSERT before either has committed (replicating the interleaving that causes the race).
let delayEmbeddings = false;

const generateEmbeddingsMock = mock(async (_model: string, texts: string[]) => {
  if (delayEmbeddings) await new Promise((r) => setTimeout(r, 5));
  return texts.map(() => [0.1, 0.2, 0.3]);
});
mock.module("../embeddings", () => ({ generateEmbeddings: generateEmbeddingsMock }));

const { ingestText } = await import("../ingest");

const now = new Date().toISOString();
const kbRow = sqlite
  .query(
    `INSERT INTO knowledge_bases
       (name, embedding_model, chunk_size, chunk_overlap, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
  .get("TestKB", "nomic-embed-text", 512, 50, now, now) as { id: number };
const kbId = kbRow.id;

beforeEach(() => {
  sqlite.exec("DELETE FROM chunks");
  sqlite.exec("DELETE FROM documents");
  generateEmbeddingsMock.mockClear();
  delayEmbeddings = false;
});

// ── Finding 1: empty / whitespace-only text ───────────────────────────────────

describe("ingestText — empty text validation (Finding 1)", () => {
  test("throws AppError.validation for empty string", async () => {
    const err = await ingestText(kbId, "test.txt", "").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "VALIDATION", statusCode: 400 });
  });

  test("throws AppError.validation for whitespace-only text", async () => {
    const err = await ingestText(kbId, "test.txt", "   \n  ").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "VALIDATION", statusCode: 400 });
  });
});

// ── Finding 2: transactional insert ──────────────────────────────────────────

describe("ingestText — transactional insert (Finding 2)", () => {
  test("rolls back document when chunk insert fails", async () => {
    // Rename chunks table to trigger chunk insert failure mid-transaction
    sqlite.exec("ALTER TABLE chunks RENAME TO chunks_bak");
    try {
      await ingestText(kbId, "rollback.txt", "some content to ingest").catch(() => {});
      const row = sqlite
        .query("SELECT COUNT(*) as cnt FROM documents")
        .get() as { cnt: number };
      expect(row.cnt).toBe(0);
    } finally {
      sqlite.exec("ALTER TABLE chunks_bak RENAME TO chunks");
    }
  });
});

// ── Finding 3: race condition / unique constraint ─────────────────────────────

describe("ingestText — concurrent dedup (Finding 3)", () => {
  test("Promise.all with same content returns same id and one document", async () => {
    // Delay generateEmbeddings so both calls complete their racy SELECT before
    // either INSERT — this is the interleaving the real race produces.
    delayEmbeddings = true;

    const [id1, id2] = await Promise.all([
      ingestText(kbId, "a.txt", "hello world content for dedup test"),
      ingestText(kbId, "b.txt", "hello world content for dedup test"),
    ]);
    expect(id1).toBe(id2);
    const row = sqlite
      .query("SELECT COUNT(*) as cnt FROM documents")
      .get() as { cnt: number };
    expect(row.cnt).toBe(1);
  });
});
