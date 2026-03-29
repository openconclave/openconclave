import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/client";
import { workflows } from "../db/schema";
import { createWorkflowSchema, updateWorkflowSchema } from "@openconclave/shared";

export const workflowRoutes = new Hono()
  .get("/", async (c) => {
    const result = await db.select().from(workflows);
    return c.json({ workflows: result });
  })

  .get("/:id", async (c) => {
    const { id } = c.req.param();
    const result = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!result.length) return c.json({ error: "Not found" }, 404);
    return c.json(result[0]);
  })

  .post("/", zValidator("json", createWorkflowSchema), async (c) => {
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const id = nanoid();
    const definition = { id, ...body, enabled: true, createdAt: now, updatedAt: now };

    await db.insert(workflows).values({
      id,
      name: body.name,
      description: body.description,
      definition,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    return c.json(definition, 201);
  })

  .put("/:id", zValidator("json", updateWorkflowSchema), async (c) => {
    const { id } = c.req.param();
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const existing = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!existing.length) return c.json({ error: "Not found" }, 404);

    const prev = existing[0];
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
    const { id } = c.req.param();
    const result = await db.delete(workflows).where(eq(workflows.id, id));
    return c.json({ deleted: true });
  });
