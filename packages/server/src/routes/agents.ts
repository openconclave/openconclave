import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { agentTasks, conclaves, runEvents } from "../db/schema";
import { AppError, ErrorCode } from "@openconclave/shared";
import type { AgentConfig, ResolvedAgentConfig, ConclaveNode } from "@openconclave/shared";
import { executeAgent } from "../engine/agent-executor";
import { invokeWithTools } from "../agent/llm-call";
import { logger } from "../lib/logger";
import { broadcastRunEvent } from "../ws/broadcast";
import type { RunEvent } from "../engine/types";

const toolDefSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.unknown()),
});

const invokeSchema = z.object({
  conclaveId: z.number(),
  runId: z.number(),
  nodeId: z.string(),
  prompt: z.string(),
  systemPromptOverride: z.string().optional(),
  tools: z.array(toolDefSchema).optional(),
});

export const agentRoutes = new Hono()
  .post("/invoke", zValidator("json", invokeSchema), async (c) => {
    const { conclaveId, runId, nodeId, prompt, systemPromptOverride, tools } = c.req.valid("json");

    const [wf] = await db.select().from(conclaves).where(eq(conclaves.id, conclaveId));
    if (!wf) throw AppError.notFound("Conclave", String(conclaveId));

    const definition = wf.definition as { nodes: ConclaveNode[] };

    const node = definition.nodes.find((n) => n.id === nodeId);
    if (!node) throw AppError.notFound("Node", nodeId);
    if (node.data.type !== "agent") {
      throw AppError.validation(`Node "${nodeId}" is not an agent`);
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

    // Collect every persistence promise so the route awaits them before
    // responding — a process restart between c.json() and the catch handler
    // would otherwise drop emitted events.
    const pendingWrites: Promise<unknown>[] = [];

    const emit = (event: RunEvent): void => {
      broadcastRunEvent(event);
      const now = new Date().toISOString();
      const p = db.insert(runEvents)
        .values({ runId: event.runId, nodeId: event.nodeId, type: event.type, data: event.data ?? null, createdAt: now })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("Failed to persist invoke event", { error: msg });
        });
      pendingWrites.push(p);
    };

    if (tools && tools.length > 0) {
      const engine = mergedConfig.engine ?? "claude";
      if (engine === "ollama" && !mergedConfig.ollamaModel) {
        throw new AppError(ErrorCode.AGENT_NO_MODEL, "No Ollama model selected");
      }
      if (engine === "openai" && !mergedConfig.openaiModel) {
        throw new AppError(ErrorCode.AGENT_NO_MODEL, "No OpenAI model selected");
      }
      const result = await invokeWithTools({
        engine,
        config: mergedConfig,
        prompt,
        tools,
        runId,
        nodeId,
        emit,
      });
      await Promise.all(pendingWrites);
      return c.json({ output: result.output, tool_call: result.tool_call ?? null });
    }

    const result = await executeAgent(runId, nodeId, mergedConfig, prompt, emit);
    await Promise.all(pendingWrites);

    return c.json({ output: result.output, tool_call: null });
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

  .get("/tasks/:id", zValidator("param", z.object({ id: z.coerce.number().int().positive() })), async (c) => {
    const { id } = c.req.valid("param");
    const [task] = await db.select().from(agentTasks).where(eq(agentTasks.id, id));
    if (!task) throw AppError.notFound("Task", String(id));
    return c.json(task);
  });
