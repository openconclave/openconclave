import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";

import { db } from "../db/client";
import { runs, agentTasks, runEvents } from "../db/schema";
import { clearPromptsForRun } from "../engine/prompt-registry";
import { AppError } from "@openconclave/shared";

export const runRoutes = new Hono()
  .get("/", async (c) => {
    const allRuns = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(50);
    const allTasks = await db.select().from(agentTasks);

    const costByRun = new Map<string, number>();
    const durationByRun = new Map<string, number>();

    for (const t of allTasks) {
      costByRun.set(t.runId, (costByRun.get(t.runId) ?? 0) + (t.costUsd ?? 0));
    }

    for (const r of allRuns) {
      if (r.startedAt && r.completedAt) {
        durationByRun.set(
          r.id,
          new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()
        );
      }
    }

    const result = allRuns.map((r) => ({
      ...r,
      totalCost: costByRun.get(r.id) ?? 0,
      durationMs: durationByRun.get(r.id) ?? null,
    }));

    return c.json({ runs: result });
  })

  .get("/:id", async (c) => {
    const { id } = c.req.param();
    const [run] = await db.select().from(runs).where(eq(runs.id, id));
    if (!run) throw AppError.notFound("Run", id);

    const tasks = await db.select().from(agentTasks).where(eq(agentTasks.runId, id));
    const events = await db.select().from(runEvents).where(eq(runEvents.runId, id));

    return c.json({ run, tasks, events });
  })

  .post("/:id/cancel", async (c) => {
    const { id } = c.req.param();
    const now = new Date().toISOString();
    await db
      .update(runs)
      .set({ status: "cancelled", completedAt: now })
      .where(eq(runs.id, id));
    await db
      .update(agentTasks)
      .set({ status: "cancelled", completedAt: now })
      .where(eq(agentTasks.runId, id));
    clearPromptsForRun(id);
    return c.json({ cancelled: true });
  });
