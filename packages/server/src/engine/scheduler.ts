import { db } from "../db/client";
import { workflows } from "../db/schema";
import { eq } from "drizzle-orm";
import { WorkflowExecutor } from "./executor";
import type { WorkflowDefinition, WorkflowNode, TriggerConfig } from "@openconclave/shared";

type ScheduledJob = {
  workflowId: string;
  cron: string;
  nextRun: Date;
  enabled: boolean;
};

function parseCron(cron: string, from: Date): Date | null {
  // Simple cron parser supporting: * and numbers for minute, hour, day, month, weekday
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minPart, hourPart, dayPart, monthPart, weekdayPart] = parts;

  const match = (part: string, value: number, max: number): boolean => {
    if (part === "*") return true;
    // Handle */N step values
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      return !isNaN(step) && step > 0 && value % step === 0;
    }
    // Handle comma-separated values
    return part.split(",").some((p) => parseInt(p) === value);
  };

  // Find the next matching time starting from 'from + 1 minute'
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Search up to 48 hours ahead
  for (let i = 0; i < 2880; i++) {
    const min = next.getMinutes();
    const hour = next.getHours();
    const day = next.getDate();
    const month = next.getMonth() + 1;
    const weekday = next.getDay();

    if (
      match(minPart, min, 59) &&
      match(hourPart, hour, 23) &&
      match(dayPart, day, 31) &&
      match(monthPart, month, 12) &&
      match(weekdayPart, weekday, 6)
    ) {
      return next;
    }

    next.setMinutes(next.getMinutes() + 1);
  }

  return null;
}

export class CronScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private executor: WorkflowExecutor;
  private checkIntervalMs: number;

  constructor(executor: WorkflowExecutor, checkIntervalMs = 15000) {
    this.executor = executor;
    this.checkIntervalMs = checkIntervalMs;
  }

  getSchedule(): { workflowId: string; cron: string; nextRun: string; enabled: boolean }[] {
    return Array.from(this.jobs.values()).map((j) => ({
      workflowId: j.workflowId,
      cron: j.cron,
      nextRun: j.nextRun.toISOString(),
      enabled: j.enabled,
    }));
  }

  async start() {
    console.log("⏰ Cron scheduler started");
    await this.sync();

    // Check for due jobs every N seconds
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);

    // Re-sync workflow definitions every 60s
    setInterval(() => this.sync(), 60000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("⏰ Cron scheduler stopped");
  }

  async sync() {
    const allWorkflows = await db.select().from(workflows);
    const activeIds = new Set<string>();

    for (const wf of allWorkflows) {
      if (!wf.enabled) continue;

      const def = wf.definition as unknown as WorkflowDefinition;
      if (!def.nodes) continue;

      // Find cron trigger nodes
      for (const node of def.nodes) {
        if (node.data?.type === "trigger") {
          const config = node.data.config as TriggerConfig;
          if (config.type === "cron" && config.cron) {
            activeIds.add(wf.id);

            const existing = this.jobs.get(wf.id);
            if (!existing || existing.cron !== config.cron) {
              const nextRun = parseCron(config.cron, new Date());
              if (nextRun) {
                this.jobs.set(wf.id, {
                  workflowId: wf.id,
                  cron: config.cron,
                  nextRun,
                  enabled: true,
                });
                console.log(
                  `⏰ Scheduled "${wf.name}" (${config.cron}) — next run: ${nextRun.toLocaleTimeString()}`
                );
              }
            }
          }
        }
      }
    }

    // Remove jobs for deleted/disabled workflows
    for (const [id] of this.jobs) {
      if (!activeIds.has(id)) {
        this.jobs.delete(id);
      }
    }
  }

  private async tick() {
    const now = new Date();

    for (const [id, job] of this.jobs) {
      if (!job.enabled) continue;
      if (now < job.nextRun) continue;

      // Time to run
      console.log(`⏰ Triggering workflow ${id} (cron: ${job.cron})`);

      try {
        const wf = await db.select().from(workflows).where(eq(workflows.id, id));
        if (!wf.length || !wf[0].enabled) {
          job.enabled = false;
          continue;
        }

        const def = wf[0].definition as unknown as WorkflowDefinition;
        await this.executor.execute(def, { cronTrigger: true, scheduledAt: now.toISOString() });
      } catch (err: any) {
        console.error(`⏰ Failed to trigger workflow ${id}:`, err.message);
      }

      // Calculate next run
      const nextRun = parseCron(job.cron, now);
      if (nextRun) {
        job.nextRun = nextRun;
      } else {
        job.enabled = false;
      }
    }
  }
}
