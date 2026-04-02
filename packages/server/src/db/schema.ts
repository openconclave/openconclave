import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const workflows = sqliteTable("workflows", {
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
  workflowId: integer("workflow_id").references(() => workflows.id).notNull(),
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
});

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
