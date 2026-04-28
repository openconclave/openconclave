import { Hono } from "hono";
import { eq, desc, inArray, and, asc } from "drizzle-orm";

import { db } from "../db/client";
import { runs, agentTasks, runEvents, checkpoints } from "../db/schema";
import { clearPromptsForRun } from "../engine/prompt-registry";
import { AppError } from "@openconclave/shared";

export const runRoutes = new Hono()
  .get("/", async (c) => {
    const allRuns = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(50);
    const runIds = allRuns.map((r) => r.id);
    const allTasks = runIds.length > 0
      ? await db.select().from(agentTasks).where(inArray(agentTasks.runId, runIds))
      : [];

    const costByRun = new Map<number, number>();
    const durationByRun = new Map<number, number>();

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
    const id = Number(c.req.param("id"));
    const [run] = await db.select().from(runs).where(eq(runs.id, id));
    if (!run) throw AppError.notFound("Run", String(id));

    const tasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.runId, id))
      .orderBy(asc(agentTasks.id));
    const events = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, id))
      .orderBy(asc(runEvents.id));

    const [latestCp] = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.runId, id))
      .orderBy(desc(checkpoints.id))
      .limit(1);

    return c.json({
      run,
      tasks,
      events,
      checkpoint: latestCp
        ? { completedNodes: latestCp.completedNodes as string[], createdAt: latestCp.createdAt }
        : null,
    });
  })

  .post("/:id/cancel", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw AppError.notFound("Run", c.req.param("id"));
    const now = new Date().toISOString();
    await db
      .update(runs)
      .set({ status: "cancelled", completedAt: now })
      .where(and(eq(runs.id, id), inArray(runs.status, ["queued", "running"])));
    await db
      .update(agentTasks)
      .set({ status: "cancelled", completedAt: now })
      .where(and(eq(agentTasks.runId, id), inArray(agentTasks.status, ["queued", "pending"])));
    clearPromptsForRun(id);
    return c.json({ cancelled: true });
  });
