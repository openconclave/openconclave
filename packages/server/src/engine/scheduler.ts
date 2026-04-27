import { logger } from "../lib/logger";
import { db } from "../db/client";
import { conclaves } from "../db/schema";
import { eq } from "drizzle-orm";
import { ConclaveExecutor } from "./executor";
import type { ConclaveDefinition, TriggerConfig } from "@openconclave/shared";

type ScheduledJob = {
  conclaveId: number;
  triggerNodeId: string;
  cron: string;
  nextRun: Date;
  enabled: boolean;
};

function parseCron(cron: string, from: Date): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minPart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  if (!minPart || !hourPart || !dayPart || !monthPart || !weekdayPart) return null;

  const match = (part: string, value: number, min = 0): boolean => {
    if (part === "*") return true;
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      return !isNaN(step) && step > 0 && (value - min) % step === 0;
    }
    return part.split(",").some((p) => parseInt(p) === value);
  };

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  for (let i = 0; i < 2880; i++) {
    const min = next.getMinutes();
    const hour = next.getHours();
    const day = next.getDate();
    const month = next.getMonth() + 1;
    const weekday = next.getDay();

    if (
      match(minPart, min) &&
      match(hourPart, hour) &&
      match(dayPart, day, 1) &&
      match(monthPart, month, 1) &&
      match(weekdayPart, weekday)
    ) {
      return next;
    }

    next.setMinutes(next.getMinutes() + 1);
  }

  return null;
}

export class CronScheduler {
  private jobs = new Map<number, ScheduledJob>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private executor: ConclaveExecutor;
  private checkIntervalMs: number;

  constructor(executor: ConclaveExecutor, checkIntervalMs = 15000) {
    this.executor = executor;
    this.checkIntervalMs = checkIntervalMs;
  }

  getSchedule(): { conclaveId: number; cron: string; nextRun: string; enabled: boolean }[] {
    return Array.from(this.jobs.values()).map((j) => ({
      conclaveId: j.conclaveId,
      cron: j.cron,
      nextRun: j.nextRun.toISOString(),
      enabled: j.enabled,
    }));
  }

  async start() {
    logger.debug("Cron scheduler started");
    await this.sync();

    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    this.syncTimer = setInterval(() => this.sync(), 60000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    logger.debug("Cron scheduler stopped");
  }

  async sync() {
    const allConclaves = await db.select().from(conclaves);
    const activeIds = new Set<number>();

    for (const wf of allConclaves) {
      if (!wf.enabled) continue;

      const def = wf.definition as unknown as ConclaveDefinition;
      if (!def.nodes) continue;

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
                  conclaveId: wf.id,
                  triggerNodeId: node.id,
                  cron: config.cron,
                  nextRun,
                  enabled: true,
                });
                logger.info(`Scheduled "${wf.name}" (${config.cron}) — next run: ${nextRun.toLocaleTimeString()}`);
              }
            }
          }
        }
      }
    }

    for (const [id] of this.jobs) {
      if (!activeIds.has(id)) {
        this.jobs.delete(id);
      }
    }
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();

      for (const [id, job] of this.jobs) {
        if (!job.enabled) continue;
        if (now < job.nextRun) continue;

        logger.info(`Triggering conclave ${id} (cron: ${job.cron})`);

        try {
          const wf = await db.select().from(conclaves).where(eq(conclaves.id, id));
          if (!wf.length || !wf[0]!.enabled) {
            job.enabled = false;
            continue;
          }

          const def = wf[0]!.definition as unknown as ConclaveDefinition;
          await this.executor.execute(def, { cronTrigger: true, scheduledAt: now.toISOString() }, job.triggerNodeId);
        } catch (err: unknown) {
          logger.error(`Failed to trigger conclave ${id}`, { error: err instanceof Error ? err.message : String(err) });
        }

        const nextRun = parseCron(job.cron, now);
        if (nextRun) {
          job.nextRun = nextRun;
        } else {
          this.jobs.delete(id);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
