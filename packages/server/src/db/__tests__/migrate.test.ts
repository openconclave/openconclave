import { test, expect, describe, mock, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA foreign_keys = OFF");
const testDb = drizzle(sqlite);
mock.module("../client", () => ({ db: testDb }));

const { runMigrations } = await import("../migrate");

beforeEach(() => {
  const tables = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const t of tables) sqlite.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  const indexes = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const i of indexes) sqlite.exec(`DROP INDEX IF EXISTS "${i.name}"`);
});

// ── MAJOR: silent catch on CREATE UNIQUE INDEX masks duplicate-data failure ───

describe("runMigrations — unique index for content_hash dedup (MAJOR)", () => {
  test("fresh migration creates a UNIQUE index on (knowledge_base_id, content_hash)", () => {
    runMigrations();
    const row = sqlite
      .query(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_documents_kb_hash'",
      )
      .get() as { sql: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.sql.toUpperCase()).toContain("UNIQUE");
  });

  test("pre-existing duplicate (knowledge_base_id, content_hash) rows make migration fail loudly", () => {
    runMigrations();
    sqlite.exec("DROP INDEX idx_documents_kb_hash");
    sqlite.exec(
      `INSERT INTO knowledge_bases (name, embedding_model, chunk_size, chunk_overlap, created_at, updated_at)
       VALUES ('kb', 'm', 512, 50, '2026-01-01', '2026-01-01')`,
    );
    sqlite.exec(
      `INSERT INTO documents (knowledge_base_id, filename, content_hash, created_at)
       VALUES (1, 'a', 'samehash', '2026-01-01'), (1, 'b', 'samehash', '2026-01-01')`,
    );
    expect(() => runMigrations()).toThrow();
    const idx = sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_documents_kb_hash'",
      )
      .get();
    expect(idx).toBeFalsy();
  });
});

// ── MINOR: bare catch on ALTER TABLE hides non-"duplicate column" errors ─────

describe("runMigrations — ALTER TABLE error handling (MINOR)", () => {
  test("running twice succeeds (duplicate-column-name error is swallowed)", () => {
    runMigrations();
    expect(() => runMigrations()).not.toThrow();
  });

  // TEST_LIMITATION: real SQLITE_BUSY needs a second writer; we hijack
  // sqlite.prepare to throw the same shape of non-duplicate error on the
  // ALTER TABLE statement, which drives the same catch branch.
  test("ALTER TABLE non-duplicate-column errors propagate", () => {
    const origPrepare = sqlite.prepare.bind(sqlite);
    (sqlite as unknown as { prepare: typeof origPrepare }).prepare = ((s: string) => {
      if (s.toLowerCase().includes("add column content")) {
        throw new Error("database is locked");
      }
      return origPrepare(s);
    }) as typeof origPrepare;
    try {
      let caught: unknown;
      try {
        runMigrations();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      const causeMsg =
        (caught as Error).cause instanceof Error
          ? ((caught as Error).cause as Error).message
          : "";
      expect(`${msg} ${causeMsg}`).toMatch(/locked|ALTER TABLE/);
    } finally {
      (sqlite as unknown as { prepare: typeof origPrepare }).prepare = origPrepare;
    }
  });
});

// ── MINOR: migration body must run inside a single transaction ───────────────

describe("runMigrations — atomic transaction wrap (MINOR)", () => {
  test("body executes inside db.transaction()", () => {
    let txCalls = 0;
    const origTx = testDb.transaction.bind(testDb);
    (testDb as unknown as { transaction: typeof origTx }).transaction = ((
      cb: Parameters<typeof origTx>[0],
    ) => {
      txCalls++;
      return origTx(cb);
    }) as typeof origTx;
    try {
      runMigrations();
      expect(txCalls).toBe(1);
    } finally {
      (testDb as unknown as { transaction: typeof origTx }).transaction = origTx;
    }
  });
});
