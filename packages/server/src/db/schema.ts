import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  definition: text("definition", { mode: "json" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").references(() => workflows.id).notNull(),
  status: text("status").notNull(),
  triggerType: text("trigger_type"),
  triggerPayload: text("trigger_payload", { mode: "json" }),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const agentTasks = sqliteTable("agent_tasks", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => runs.id).notNull(),
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
  runId: text("run_id").references(() => runs.id).notNull(),
  nodeId: text("node_id"),
  type: text("type").notNull(),
  data: text("data", { mode: "json" }),
  createdAt: text("created_at").notNull(),
});

export const mcpServers = sqliteTable("mcp_servers", {
  name: text("name").primaryKey(),
  type: text("type").notNull(),
  config: text("config", { mode: "json" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  createdAt: text("created_at").notNull(),
});
