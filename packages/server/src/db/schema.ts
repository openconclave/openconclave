import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const conclaves = sqliteTable("conclaves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  definition: text("definition", { mode: "json" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conclaveId: integer("conclave_id").references(() => conclaves.id).notNull(),
  status: text("status").notNull(),
  triggerType: text("trigger_type"),
  triggerPayload: text("trigger_payload", { mode: "json" }),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const agentTasks = sqliteTable("agent_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").references(() => runs.id).notNull(),
  nodeId: text("node_id").notNull(),
  status: text("status").notNull(),
  prompt: text("prompt").notNull(),
  systemPrompt: text("system_prompt"),
  model: text("model").default("sonnet"),
  input: text("input", { mode: "json" }),
  output: text("output", { mode: "json" }),
  error: text("error"),
  tokensUsed: integer("tokens_used"),
  costUsd: real("cost_usd"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").references(() => runs.id).notNull(),
  nodeId: text("node_id"),
  type: text("type").notNull(),
  data: text("data", { mode: "json" }),
  createdAt: text("created_at").notNull(),
});

export const checkpoints = sqliteTable("checkpoints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").references(() => runs.id).notNull(),
  nodeId: text("node_id").notNull(),
  // Full snapshot of raw executeNode outputs at checkpoint time — never mutated by resolveNextEntries.
  // Each row is a complete accumulation so resume only needs the latest row.
  nodeOutputs: text("node_outputs", { mode: "json" }).notNull(),    // Record<nodeId, raw output>
  completedNodes: text("completed_nodes", { mode: "json" }).notNull(), // string[]
  agentSessions: text("agent_sessions", { mode: "json" }).notNull(), // Record<nodeId, sessionId>
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const knowledgeBases = sqliteTable("knowledge_bases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  embeddingModel: text("embedding_model").notNull().default("nomic-embed-text"),
  chunkSize: integer("chunk_size").notNull().default(512),
  chunkOverlap: integer("chunk_overlap").notNull().default(50),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  knowledgeBaseId: integer("knowledge_base_id").references(() => knowledgeBases.id).notNull(),
  filename: text("filename").notNull(),
  sourcePath: text("source_path"),
  content: text("content"),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  kbHashUnique: uniqueIndex("idx_documents_kb_hash").on(table.knowledgeBaseId, table.contentHash),
}));

export const chunks = sqliteTable("chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").references(() => documents.id).notNull(),
  knowledgeBaseId: integer("knowledge_base_id").references(() => knowledgeBases.id).notNull(),
  content: text("content").notNull(),
  metadata: text("metadata", { mode: "json" }),
  embedding: text("embedding").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
});

export const mcpServers = sqliteTable("mcp_servers", {
  name: text("name").primaryKey(),
  type: text("type").notNull(),
  config: text("config", { mode: "json" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  createdAt: text("created_at").notNull(),
});
