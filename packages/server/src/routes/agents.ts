import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { agentTasks } from "../db/schema";

export const agentRoutes = new Hono()
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
    const task = await db.select().from(agentTasks).where(eq(agentTasks.id, id));
    if (!task.length) return c.json({ error: "Not found" }, 404);
    return c.json(task[0]);
  });
