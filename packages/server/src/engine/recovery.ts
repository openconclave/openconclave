import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs, agentTasks } from "../db/schema";
import { logger } from "../lib/logger";

/**
 * On server startup, mark any "running" runs/tasks as "interrupted".
 * These are leftovers from a previous server instance that crashed or restarted
 * (e.g., hot-reload killed the executor mid-flight).
 */
export async function recoverStaleRuns(): Promise<void> {
  const now = new Date().toISOString();

  // Find all stale running tasks
  const staleTasks = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.status, "running"));

  if (staleTasks.length > 0) {
    await db
      .update(agentTasks)
      .set({
        status: "interrupted",
        error: "Server restarted while task was running",
        completedAt: now,
      })
      .where(eq(agentTasks.status, "running"));

    logger.warn(`Recovered ${staleTasks.length} stale agent task(s)`, {
      taskIds: staleTasks.map((t) => t.id),
    });
  }

  // Find all stale running runs
  const staleRuns = await db
    .select()
    .from(runs)
    .where(eq(runs.status, "running"));

  if (staleRuns.length > 0) {
    await db
      .update(runs)
      .set({
        status: "interrupted",
        error: "Server restarted while workflow was running",
        completedAt: now,
      })
      .where(eq(runs.status, "running"));

    logger.warn(`Recovered ${staleRuns.length} stale run(s)`, {
      runIds: staleRuns.map((r) => r.id),
    });
  }
}
