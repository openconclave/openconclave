import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { conclaves, runs, agentTasks, runEvents, checkpoints } from "../db/schema";
import {
  createConclaveSchema,
  updateConclaveSchema,
  AppError,
} from "@openconclave/shared";

export const conclaveRoutes = new Hono()
  .get("/", async (c) => {
    const result = await db.select().from(conclaves);
    return c.json({ conclaves: result });
  })

  .get("/:id", async (c) => {
    const { id } = c.req.param();
    const [result] = await db.select().from(conclaves).where(eq(conclaves.id, Number(id)));
    if (!result) throw AppError.notFound("Conclave", id);
    return c.json(result);
  })

  .post("/", zValidator("json", createConclaveSchema), async (c) => {
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const result = await db.insert(conclaves).values({
      name: body.name,
      description: body.description,
      definition: { ...body, enabled: true, createdAt: now, updatedAt: now },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: conclaves.id });

    const id = result[0]!.id;
    // Update definition with the generated ID
    await db.update(conclaves)
      .set({ definition: { id, ...body, enabled: true, createdAt: now, updatedAt: now } })
      .where(eq(conclaves.id, id));

    return c.json({ id, ...body, enabled: true, createdAt: now, updatedAt: now }, 201);
  })

  .put("/:id", zValidator("json", updateConclaveSchema), async (c) => {
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const [prev] = await db.select().from(conclaves).where(eq(conclaves.id, id));
    if (!prev) throw AppError.notFound("Conclave", String(id));

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

    await db.update(conclaves).set(updated).where(eq(conclaves.id, id));
    return c.json(updated.definition);
  })

  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));

    // Delete related data first (cascade)
    const conclaveRuns = await db.select().from(runs).where(eq(runs.conclaveId, id));
    for (const run of conclaveRuns) {
      await db.delete(checkpoints).where(eq(checkpoints.runId, run.id));
      await db.delete(runEvents).where(eq(runEvents.runId, run.id));
      await db.delete(agentTasks).where(eq(agentTasks.runId, run.id));
    }
    await db.delete(runs).where(eq(runs.conclaveId, id));
    await db.delete(conclaves).where(eq(conclaves.id, id));

    return c.json({ deleted: true });
  });
