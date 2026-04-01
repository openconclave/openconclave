import { db } from "../db/client";
import { runs, runEvents } from "../db/schema";
import { executeGraph } from "./graph-walker";
import { logger } from "../lib/logger";
import type { WorkflowDefinition } from "@openconclave/shared";

import type { RunEvent, EventCallback } from "./types";

// Re-export types for consumers
export type { RunEvent, EventCallback } from "./types";

// ── Executor ────────────────────────────────────────────────

export class WorkflowExecutor {
  private readonly onEvent?: EventCallback;

  constructor(onEvent?: EventCallback) {
    this.onEvent = onEvent;
  }

  /** Continue an existing run with a new message (chat) */
  async executeInRun(
    runId: number,
    workflow: WorkflowDefinition,
    triggerPayload?: unknown,
    triggerNodeId?: string
  ): Promise<void> {
    const emit = (event: RunEvent) => this.emit(event);

    executeGraph(runId, workflow, emit, triggerPayload, triggerNodeId).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Run ${runId} continued message failed`, { error: message });
      }
    );
  }

  async execute(
    workflow: WorkflowDefinition,
    triggerPayload?: unknown,
    triggerNodeId?: string
  ): Promise<number> {
    const now = new Date().toISOString();

    const result = await db.insert(runs).values({
      workflowId: workflow.id as number,
      status: "running",
      triggerType: "manual",
      triggerPayload: triggerPayload ?? null,
      startedAt: now,
      createdAt: now,
    }).returning({ id: runs.id });

    const runId = result[0].id;

    this.emit({ type: "run:started", runId });

    const emit = (event: RunEvent) => this.emit(event);

    executeGraph(runId, workflow, emit, triggerPayload, triggerNodeId).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Run ${runId} failed`, { error: message });
      }
    );

    return runId;
  }

  // ── Events ──────────────────────────────────────────────

  private emit(event: RunEvent): void {
    const now = new Date().toISOString();
    db.insert(runEvents)
      .values({
        runId: event.runId,
        nodeId: event.nodeId,
        type: event.type,
        data: event.data ?? null,
        createdAt: now,
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Failed to persist event", { error: message });
      });

    this.onEvent?.(event);
  }
}
