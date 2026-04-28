import { db } from "./client";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

// Idempotent: every DDL statement uses IF NOT EXISTS or guards against duplicate-error.
export function runMigrations(): void {
  logger.debug("Running database migrations");

  db.transaction((tx) => {
    tx.run(sql`CREATE TABLE IF NOT EXISTS conclaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      definition TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conclave_id INTEGER NOT NULL REFERENCES conclaves(id),
      status TEXT NOT NULL,
      trigger_type TEXT,
      trigger_payload TEXT,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      node_id TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      system_prompt TEXT,
      model TEXT DEFAULT 'sonnet',
      input TEXT,
      output TEXT,
      error TEXT,
      tokens_used INTEGER,
      cost_usd REAL,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      node_id TEXT,
      type TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      node_id TEXT NOT NULL,
      node_outputs TEXT NOT NULL,
      completed_nodes TEXT NOT NULL,
      agent_sessions TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS knowledge_bases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      embedding_model TEXT NOT NULL DEFAULT 'nomic-embed-text',
      chunk_size INTEGER NOT NULL DEFAULT 512,
      chunk_overlap INTEGER NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    tx.run(sql`CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_base_id INTEGER NOT NULL REFERENCES knowledge_bases(id),
      filename TEXT NOT NULL,
      source_path TEXT,
      content TEXT,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);

    try {
      tx.run(sql`ALTER TABLE documents ADD COLUMN content TEXT`);
    } catch (err) {
      // Column already exists; drizzle wraps the underlying sqlite error so the original message lives on err.cause.
      const msg = err instanceof Error ? err.message : "";
      const causeMsg =
        err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
      if (
        !msg.includes("duplicate column name: content") &&
        !causeMsg.includes("duplicate column name: content")
      ) {
        throw err;
      }
    }

    tx.run(sql`CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id),
      knowledge_base_id INTEGER NOT NULL REFERENCES knowledge_bases(id),
      content TEXT NOT NULL,
      metadata TEXT,
      embedding TEXT NOT NULL,
      chunk_index INTEGER NOT NULL
    )`);

    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_conclave_id ON runs(conclave_id)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_tasks_run_id ON agent_tasks(run_id)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_run_events_type ON run_events(type)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_documents_kb_id ON documents(knowledge_base_id)`);
    tx.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_kb_hash ON documents(knowledge_base_id, content_hash)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(document_id)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_kb_id ON chunks(knowledge_base_id)`);
    tx.run(sql`CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints(run_id)`);
  });

  logger.debug("Database migrations complete");
}
