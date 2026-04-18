import type { AgentTask, Run, RunEvent } from "@openconclave/shared";
import { nodeKindOf, nodeIcon, type UINodeType } from "./atoms";

interface GanttProps {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
  nodeLabels: Map<string, string>;
  nodeTypes: Map<string, string>;
}

interface Bar {
  nodeId: string;
  label: string;
  kind: UINodeType;
  startOffsetMs: number;
  endOffsetMs: number | null; /* null = still running (clamp to runEnd) */
  status: string;
  model?: string;
  channelAtMs?: number;
}

export function Gantt({ run, tasks, events, nodeLabels, nodeTypes }: GanttProps) {
  const origin = new Date(run.startedAt ?? run.createdAt).getTime();
  const isLive = run.status === "running" || run.status === "queued";
  const now = Date.now();
  const endTime = run.completedAt ? new Date(run.completedAt).getTime() : isLive ? now : origin + 1000;
  const totalMs = Math.max(1000, endTime - origin);

  // Build one bar per unique (nodeId, task) — tasks are per-agent; we also need to show non-agent
  // nodes from events (node:started / node:completed)
  const bars: Bar[] = [];

  for (const task of tasks) {
    if (!task.startedAt) continue;
    const start = new Date(task.startedAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : null;
    bars.push({
      nodeId: task.nodeId,
      label: nodeLabels.get(task.nodeId) ?? task.nodeId,
      kind: nodeKindOf(nodeTypes.get(task.nodeId)),
      startOffsetMs: start - origin,
      endOffsetMs: end != null ? end - origin : null,
      status: task.status,
      model: task.model ?? undefined,
    });
  }

  // Add non-agent node bars by tracking node:started / node:completed events
  const nodeEventStarts = new Map<string, number>();
  const nodeEventEnds = new Map<string, number>();
  const agentNodeIds = new Set(tasks.map((t) => t.nodeId));
  for (const e of events) {
    if (!e.nodeId || agentNodeIds.has(e.nodeId)) continue;
    const t = new Date(e.createdAt).getTime();
    if (e.type === "node:started" && !nodeEventStarts.has(e.nodeId)) nodeEventStarts.set(e.nodeId, t);
    if (e.type === "node:completed" || e.type === "node:failed" || e.type === "node:skipped") {
      if (!nodeEventEnds.has(e.nodeId)) nodeEventEnds.set(e.nodeId, t);
    }
  }
  for (const [nodeId, startTime] of nodeEventStarts) {
    const endT = nodeEventEnds.get(nodeId) ?? null;
    bars.push({
      nodeId,
      label: nodeLabels.get(nodeId) ?? nodeId,
      kind: nodeKindOf(nodeTypes.get(nodeId)),
      startOffsetMs: startTime - origin,
      endOffsetMs: endT != null ? endT - origin : null,
      status: endT != null ? "complete" : "running",
    });
  }

  // Sort by start time
  bars.sort((a, b) => a.startOffsetMs - b.startOffsetMs);

  // Find channel markers (prompt:question events) and attach to the most-recent running bar
  for (const e of events) {
    if (e.type !== "prompt:question") continue;
    const t = new Date(e.createdAt).getTime() - origin;
    const bar = bars.find((b) => b.nodeId === e.nodeId && b.startOffsetMs <= t && (b.endOffsetMs == null || b.endOffsetMs >= t));
    if (bar) bar.channelAtMs = t;
  }

  const scale = (ms: number): string => `${Math.min(100, (ms / totalMs) * 100)}%`;

  const ruler = makeRuler(totalMs);

  return (
    <div className="gantt">
      <div className="gantt-ruler">
        {ruler.map((r) => <span key={r}>{r}</span>)}
      </div>
      {bars.length === 0 ? (
        <div style={{ padding: "20px 0", color: "var(--text-faint)", fontSize: 12 }}>
          No timeline data yet. Bars will appear as nodes start running.
        </div>
      ) : (
        bars.map((b) => {
          const end = b.endOffsetMs ?? totalMs;
          const durMs = end - b.startOffsetMs;
          const durText = formatBarDuration(durMs);
          const barClass = b.status === "running" ? "running" : b.status === "failure" ? "err" : b.kind;
          const barText = durText + (b.model ? ` · ${b.model}` : "");
          return (
            <div className="gantt-row" key={`${b.nodeId}-${b.startOffsetMs}`}>
              <div className="gantt-label">
                <span className={`gi ti ${b.kind}`}>{nodeIcon(b.kind)}</span>
                <span className="t">{b.label}</span>
              </div>
              <div className="gantt-track">
                <div
                  className={`gantt-bar ${barClass}`}
                  style={{
                    left: scale(b.startOffsetMs),
                    width: `calc(${scale(durMs)} + 2px)`,
                  }}
                  title={`${b.label} · ${durText}${b.model ? ` · ${b.model}` : ""}`}
                >
                  {barText}
                </div>
                {b.channelAtMs != null && (
                  <div
                    className="gantt-channel-marker"
                    style={{ left: scale(b.channelAtMs) }}
                    title="Channel loop question"
                  />
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function formatBarDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s - m * 60).toFixed(0)}s`;
}

function makeRuler(totalMs: number): string[] {
  const totalSec = totalMs / 1000;
  const ticks = 5;
  const step = totalSec / (ticks - 1);
  return Array.from({ length: ticks }, (_, i) => {
    const s = Math.round(i * step);
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  });
}
