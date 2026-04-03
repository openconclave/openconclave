import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { resolve, join } from "path";
import { mkdirSync, existsSync, readFileSync, unlinkSync } from "fs";

import { db } from "../db/client";
import { agentTasks, workflows, runEvents } from "../db/schema";
import { AppError, ErrorCode } from "@openconclave/shared";
import type { AgentConfig, ResolvedAgentConfig, WorkflowNode } from "@openconclave/shared";
import { executeAgent } from "../engine/agent-executor";
import { invokeWithTools } from "../agent/llm-call";
import { logger } from "../lib/logger";
import { TMP_DIR } from "../lib/workspace";
import type { RunEvent } from "../engine/types";

const toolDefSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.unknown()),
});

const invokeSchema = z.object({
  workflowId: z.number(),
  runId: z.number(),
  nodeId: z.string(),
  prompt: z.string(),
  systemPromptOverride: z.string().optional(),
  tools: z.array(toolDefSchema).optional(),
});

export const agentRoutes = new Hono()
  .post("/invoke", zValidator("json", invokeSchema), async (c) => {
    const { workflowId, runId, nodeId, prompt, systemPromptOverride, tools } = c.req.valid("json");

    const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
    if (!wf) throw AppError.notFound("Workflow", String(workflowId));

    const definition = typeof wf.definition === "string"
      ? JSON.parse(wf.definition as string)
      : wf.definition;

    const node = (definition.nodes as WorkflowNode[]).find((n) => n.id === nodeId);
    if (!node) throw AppError.notFound("Node", nodeId);
    if (node.data.type !== "agent") {
      throw new AppError(ErrorCode.VALIDATION, `Node "${nodeId}" is not an agent`);
    }

    const agentConfig = node.data.config as AgentConfig;
    const mergedConfig: ResolvedAgentConfig = {
      ...agentConfig,
      allowedTools: (agentConfig.tools ?? []).filter((t) => t.toolType === "builtin").map((t) => t.toolId),
      mcpServers: (agentConfig.tools ?? []).filter((t) => t.toolType === "mcp").map((t) => t.toolId),
      knowledgeBases: (agentConfig.tools ?? []).filter((t) => t.toolType === "knowledge").map((t) => t.toolId),
    };

    if (systemPromptOverride) {
      mergedConfig.systemPrompt = systemPromptOverride;
    }

    const emit = (event: RunEvent): void => {
      const now = new Date().toISOString();
      db.insert(runEvents)
        .values({ runId: event.runId, nodeId: event.nodeId, type: event.type, data: event.data ?? null, createdAt: now })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("Failed to persist invoke event", { error: msg });
        });
    };

    // When tools are provided, use the structured tool call path
    if (tools && tools.length > 0) {
      const engine = mergedConfig.engine ?? "claude";
      const result = await invokeWithTools({
        engine,
        config: mergedConfig,
        prompt,
        tools,
        runId,
        nodeId,
        emit,
      });
      return c.json(result);
    }

    const result = await executeAgent(runId, nodeId, mergedConfig, prompt, emit);

    return c.json({ output: result.output });
  })

  .get("/status", async (c) => {
    const running = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, "running"));
    const queued = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, "queued"));

    return c.json({ running, queued });
  })

  .get("/tasks/:id/logs", async (c) => {
    const { id } = c.req.param();
    const [task] = await db.select().from(agentTasks).where(eq(agentTasks.id, id));
    if (!task) throw AppError.notFound("Task", id);
    return c.json(task);
  });
