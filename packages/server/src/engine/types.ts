// ── Shared types for the engine module ──────────────────────

export interface RunEvent {
  type: string;
  runId: number;
  nodeId?: string;
  data?: unknown;
}

export interface QueueEntry {
  nodeId: string;
  triggeredBy: string | null;
}

export interface RouteTarget {
  nodeId: string;
  label: string;
  type: string;
  description?: string;
}

export type EventCallback = (event: RunEvent) => void;
