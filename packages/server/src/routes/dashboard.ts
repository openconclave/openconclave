import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";

import { db } from "../db/client";
import { conclaves, runs, agentTasks, runEvents } from "../db/schema";
import type { CronScheduler } from "../engine/scheduler";

export function createDashboardRoutes(scheduler: CronScheduler) {
  return new Hono()
    .get("/", async (c) => {
      const allConclaves = await db.select().from(conclaves);
      const allRuns = await db.select().from(runs).orderBy(desc(runs.createdAt));
      const allTasks = await db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt));

      const successCount = allRuns.filter((r) => r.status === "success").length;
      const failureCount = allRuns.filter((r) => r.status === "failure").length;
      const cancelledCount = allRuns.filter((r) => r.status === "cancelled").length;
      const totalCost = allTasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

      const recentOutputEvents = await db
        .select()
        .from(runEvents)
        .where(eq(runEvents.type, "channel:output"))
        .orderBy(desc(runEvents.createdAt))
        .limit(10);

      let schedule: unknown[] = [];
      try {
        schedule = scheduler.getSchedule();
      } catch {
        // Scheduler may not be initialized yet
      }

      return c.json({
        totalConclaves: allConclaves.length,
        activeRuns: allRuns.filter((r) => r.status === "running").length,
        recentRuns: allRuns.slice(0, 20),
        agentTasks: allTasks.slice(0, 20),
        successCount,
        failureCount,
        cancelledCount,
        totalRuns: allRuns.length,
        totalCost,
        conclaves: allConclaves.map((w) => {
          const def = w.definition as Record<string, unknown> | null;
          const nodes = (def?.nodes ?? []) as Array<{ data?: { type?: string; config?: unknown } }>;
          const triggerNode = nodes.find((n) => n.data?.type === "trigger");
          const triggerType = (triggerNode?.data?.config as Record<string, unknown> | undefined)?.type as string | undefined;
          return { id: w.id, name: w.name, enabled: w.enabled, toolName: def?.toolName as string | undefined, triggerType };
        }),
        recentOutputs: recentOutputEvents,
        schedule,
      });
    });
}
