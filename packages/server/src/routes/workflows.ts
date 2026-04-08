import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { workflows, runs, agentTasks, runEvents, checkpoints } from "../db/schema";
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  AppError,
} from "@openconclave/shared";

export const workflowRoutes = new Hono()
  .get("/", async (c) => {
    const result = await db.select().from(workflows);
    return c.json({ workflows: result });
  })

  .get("/:id", async (c) => {
    const { id } = c.req.param();
    const [result] = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!result) throw AppError.notFound("Workflow", id);
    return c.json(result);
  })

  .post("/", zValidator("json", createWorkflowSchema), async (c) => {
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const result = await db.insert(workflows).values({
      name: body.name,
      description: body.description,
      definition: { ...body, enabled: true, createdAt: now, updatedAt: now },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: workflows.id });

    const id = result[0].id;
    // Update definition with the generated ID
    await db.update(workflows)
      .set({ definition: { id, ...body, enabled: true, createdAt: now, updatedAt: now } })
      .where(eq(workflows.id, id));

    return c.json({ id, ...body, enabled: true, createdAt: now, updatedAt: now }, 201);
  })

  .put("/:id", zValidator("json", updateWorkflowSchema), async (c) => {
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const [prev] = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!prev) throw AppError.notFound("Workflow", String(id));

    const updated = {
      name: body.name ?? prev.name,
      description: body.description ?? prev.description,
      definition: {
        ...(prev.definition as object),
        ...body,
        id,
        updatedAt: now,
      },
      enabled: body.enabled ?? prev.enabled,
      updatedAt: now,
    };

    await db.update(workflows).set(updated).where(eq(workflows.id, id));
    return c.json(updated.definition);
  })

  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));

    // Delete related data first (cascade)
    const workflowRuns = await db.select().from(runs).where(eq(runs.workflowId, id));
    for (const run of workflowRuns) {
      await db.delete(checkpoints).where(eq(checkpoints.runId, run.id));
      await db.delete(runEvents).where(eq(runEvents.runId, run.id));
      await db.delete(agentTasks).where(eq(agentTasks.runId, run.id));
    }
    await db.delete(runs).where(eq(runs.workflowId, id));
    await db.delete(workflows).where(eq(workflows.id, id));

    return c.json({ deleted: true });
  });
