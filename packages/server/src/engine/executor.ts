import { eq, desc } from "drizzle-orm";

import { db } from "../db/client";
import { runs, runEvents, checkpoints } from "../db/schema";
import { executeGraph } from "./graph-walker";
import { logger } from "../lib/logger";
import { saveAttachmentsForRun, type AttachmentInput, type SavedAttachment } from "../lib/workspace";
import type { ConclaveDefinition } from "@openconclave/shared";

import type { RunEvent, EventCallback } from "./types";

// Re-export types for consumers
export type { RunEvent, EventCallback } from "./types";

// ── Executor ────────────────────────────────────────────────

function applyAttachmentsToPayload(payload: unknown, saved: SavedAttachment[]): unknown {
  if (!saved.length) return payload;
  const names = saved.map((a) => a.filename).join(", ");
  const hint = `[${saved.length} attachment(s): ${names}. Call list_attachments to see them, read_attachment to read, grep_attachment to search.]`;
  if (typeof payload === "string") return `${hint}\n\n${payload}`;
  if (payload == null) return hint;
  return { attachments: saved, payload };
}

export class ConclaveExecutor {
  private readonly onEvent?: EventCallback;

  constructor(onEvent?: EventCallback) {
    this.onEvent = onEvent;
  }

  /** Continue an existing run with a new message (chat) */
  async executeInRun(
    runId: number,
    conclave: ConclaveDefinition,
    triggerPayload?: unknown,
    triggerNodeId?: string,
    attachments?: AttachmentInput[]
  ): Promise<void> {
    const emit = (event: RunEvent) => this.emit(event);
    const saved = saveAttachmentsForRun(runId, attachments);
    const payload = applyAttachmentsToPayload(triggerPayload, saved);

    executeGraph(runId, conclave, emit, payload, triggerNodeId).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Run ${runId} continued message failed`, { error: message });
      }
    );
  }

  async execute(
    conclave: ConclaveDefinition,
    triggerPayload?: unknown,
    triggerNodeId?: string,
    attachments?: AttachmentInput[]
  ): Promise<number> {
    const now = new Date().toISOString();

    const result = await db.insert(runs).values({
      conclaveId: Number(conclave.id),
      status: "running",
      triggerType: "manual",
      triggerPayload: triggerPayload ?? null,
      startedAt: now,
      createdAt: now,
    }).returning({ id: runs.id });

    const runId = result[0]!.id;

    this.emit({ type: "run:started", runId });

    const emit = (event: RunEvent) => this.emit(event);
    const saved = saveAttachmentsForRun(runId, attachments);
    const payload = applyAttachmentsToPayload(triggerPayload, saved);

    executeGraph(runId, conclave, emit, payload, triggerNodeId).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Run ${runId} failed`, { error: message });
      }
    );

    return runId;
  }

  /**
   * Resume a failed or interrupted run from its latest checkpoint.
   *
   * PRECONDITION: the caller (resume route in index.ts) has already atomically updated
   * run.status to "running" via a conditional UPDATE. This prevents double-resume races —
   * only one concurrent request can win the atomic claim.
   *
   * If no checkpoint exists (the run failed before completing any node), executeGraph
   * runs from scratch — equivalent to a clean retry with at-least-once semantics.
   */
  async resume(runId: number, conclave: ConclaveDefinition): Promise<void> {
    const [latestCp] = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.runId, runId))
      .orderBy(desc(checkpoints.id))
      .limit(1);

    const nodes = (conclave.nodes ?? []) as Array<{ id: string; data?: { type?: string } }>;
    const triggerNode = nodes.find((n) => n.data?.type === "trigger");
    const emit = (event: RunEvent) => this.emit(event);

    this.emit({ type: "run:started", runId });

    executeGraph(runId, conclave, emit, undefined, triggerNode?.id, latestCp?.id).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Run ${runId} resume failed`, { error: message });
      }
    );
  }

  // ── Events ──────────────────────────────────────────────

  private emit(event: RunEvent): void {
    // Skip DB persistence for high-frequency streaming events — they're only
    // useful for the live WebSocket feed. The final output is captured in
    // agent_tasks.output when the task completes. Persisting every chunk
    // saturates the event loop with synchronous bun:sqlite writes (issue #29).
    if (event.type !== "agent:output") {
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
    }

    this.onEvent?.(event);
  }
}
