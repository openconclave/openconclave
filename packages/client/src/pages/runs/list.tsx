import { useState } from "react";
import type { Run, RunStatus } from "@openconclave/shared";
import { RI, StatusPill, TriggerIcon, formatDuration, formatRelative, formatCost } from "./atoms";

export type RunWithMeta = Run & {
  totalCost?: number;
  durationMs?: number | null;
};

export interface ConclaveMeta {
  name: string;
  toolName?: string;
  triggerType?: string;
}

export type TriggerFilter = "all" | "manual" | "schedule" | "webhook";
export type StatusFilter = "all" | "active" | "failure";

export function RunsHeader({
  filteredCount,
  totalCount,
  query,
  setQuery,
  autoRefresh,
  setAutoRefresh,
}: {
  filteredCount: number;
  totalCount: number;
  query: string;
  setQuery: (q: string) => void;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
}) {
  return (
    <header className="runs-header">
      <div className="runs-title">
        Runs
        <span className="count-dim">{filteredCount} of {totalCount}</span>
      </div>
      <div style={{ flex: 1 }} />
      <div className="runs-search">
        <RI.Search />
        <input
          placeholder="Search runs, conclaves…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search runs"
        />
      </div>
      <button
        className={`runs-btn ${autoRefresh ? "primary" : "secondary"}`}
        onClick={() => setAutoRefresh(!autoRefresh)}
        type="button"
      >
        <RI.Refresh />
        Auto-refresh
      </button>
    </header>
  );
}

export function RunsFilters({
  statusFilter,
  setStatusFilter,
  triggerFilter,
  setTriggerFilter,
  runs,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (s: StatusFilter) => void;
  triggerFilter: TriggerFilter;
  setTriggerFilter: (t: TriggerFilter) => void;
  runs: RunWithMeta[];
}) {
  return (
    <div className="runs-filters">
      <button
        className={`runs-chip ${statusFilter === "active" ? "on" : ""}`}
        onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
        type="button"
      >
        Active{statusFilter === "active" && <span className="x">×</span>}
      </button>
      <button
        className={`runs-chip ${statusFilter === "failure" ? "on" : ""}`}
        onClick={() => setStatusFilter(statusFilter === "failure" ? "all" : "failure")}
        type="button"
      >
        Failed{statusFilter === "failure" && <span className="x">×</span>}
      </button>
      <div className="sep-v" />
      {(["manual", "schedule", "webhook"] as TriggerFilter[]).map((t) => (
        <button
          key={t}
          className={`runs-chip ${triggerFilter === t ? "on" : ""}`}
          onClick={() => setTriggerFilter(triggerFilter === t ? "all" : t)}
          type="button"
        >
          {t === "manual" ? "Manual" : t === "schedule" ? "Scheduled" : "Webhook"}
          {triggerFilter === t && <span className="x">×</span>}
        </button>
      ))}

      <VolumeStrip runs={runs} />
    </div>
  );
}

export function RunsList({
  runs,
  conclaves,
  selectedId,
  onSelect,
}: {
  runs: RunWithMeta[];
  conclaves: Map<string, ConclaveMeta>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="runs-list-col">
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>
          No runs match the current filters.
        </div>
      </div>
    );
  }

  const { today, thisWeek, older } = groupRunsByTime(runs);

  return (
    <div className="runs-list-col">
      {today.length > 0 && (
        <RunGroup title="Today" runs={today} conclaves={conclaves} selectedId={selectedId} onSelect={onSelect} />
      )}
      {thisWeek.length > 0 && (
        <RunGroup title="Earlier this week" runs={thisWeek} conclaves={conclaves} selectedId={selectedId} onSelect={onSelect} />
      )}
      {older.length > 0 && (
        <RunGroup title="Older" runs={older} conclaves={conclaves} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  );
}

export function filterRuns(
  runs: RunWithMeta[],
  query: string,
  statusFilter: StatusFilter,
  triggerFilter: TriggerFilter,
  conclaves: Map<string, ConclaveMeta>,
): RunWithMeta[] {
  return runs.filter((r) => {
    if (statusFilter === "active" && !(r.status === "running" || r.status === "queued")) return false;
    if (statusFilter === "failure" && r.status !== "failure") return false;
    if (triggerFilter !== "all" && r.triggerType !== triggerFilter) return false;
    if (query) {
      const name = conclaves.get(String(r.conclaveId))?.name ?? "";
      const q = query.toLowerCase();
      if (!name.toLowerCase().includes(q) && !String(r.id).includes(q)) return false;
    }
    return true;
  });
}

function groupRunsByTime(runs: RunWithMeta[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = startOfToday - 6 * 86400000;
  const today: RunWithMeta[] = [];
  const thisWeek: RunWithMeta[] = [];
  const older: RunWithMeta[] = [];
  for (const r of runs) {
    const t = new Date(r.createdAt).getTime();
    if (t >= startOfToday) today.push(r);
    else if (t >= weekAgo) thisWeek.push(r);
    else older.push(r);
  }
  return { today, thisWeek, older };
}

function groupSummary(runs: RunWithMeta[]): string {
  const succ = runs.filter((r) => r.status === "success").length;
  const running = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  const failed = runs.filter((r) => r.status === "failure").length;
  const parts: string[] = [];
  if (succ > 0) parts.push(`${succ} succeeded`);
  if (running > 0) parts.push(`${running} running`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

function RunGroup({
  title,
  runs,
  conclaves,
  selectedId,
  onSelect,
}: {
  title: string;
  runs: RunWithMeta[];
  conclaves: Map<string, ConclaveMeta>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`run-group ${open ? "" : "collapsed"}`}>
      <button className="run-group-head" onClick={() => setOpen(!open)} type="button">
        <span className="chev"><RI.ChevDown /></span>
        <span>{title}</span>
        <span className="count">{runs.length}</span>
        <span className="summary">{groupSummary(runs)}</span>
      </button>
      <div className="rows">
        {runs.map((r) => (
          <RunRow
            key={r.id}
            run={r}
            conclave={conclaves.get(String(r.conclaveId))}
            selected={selectedId === r.id}
            onClick={() => onSelect(r.id)}
          />
        ))}
      </div>
    </div>
  );
}

function RunRow({
  run,
  conclave,
  selected,
  onClick,
}: {
  run: RunWithMeta;
  conclave?: ConclaveMeta;
  selected: boolean;
  onClick: () => void;
}) {
  const duration = formatDuration(run.startedAt, run.completedAt, run.durationMs);
  return (
    <button
      className={`run-row ${statusClass(run.status)}${selected ? " sel" : ""}`}
      onClick={onClick}
      type="button"
    >
      <div className="status-bar" />
      <div className="run-main">
        <div className="run-title">
          <span>{conclave?.name ?? "Unknown conclave"}</span>
          <span className="id">#{run.id}</span>
          <StatusPill status={run.status} />
        </div>
        <div className="run-meta">
          <span><TriggerIcon kind={run.triggerType} /> {run.triggerType ?? "manual"}</span>
          <span className="d">•</span>
          <span><RI.Clock /> {duration ?? "—"}</span>
          <span className="d">•</span>
          <span>{formatCost(run.totalCost)}</span>
        </div>
      </div>
      <div className="run-right">
        <div className="when">{formatRelative(run.createdAt)}</div>
      </div>
    </button>
  );
}

function statusClass(status: RunStatus): string {
  if (status === "failure") return "failure";
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  if (status === "success") return "success";
  return status;
}

function VolumeStrip({ runs }: { runs: RunWithMeta[] }) {
  const buckets = Array.from({ length: 24 }, () => 0);
  const now = Date.now();
  for (const r of runs) {
    const t = new Date(r.createdAt).getTime();
    const hoursAgo = Math.floor((now - t) / 3600000);
    if (hoursAgo >= 0 && hoursAgo < 24) {
      const idx = 23 - hoursAgo;
      buckets[idx] = (buckets[idx] ?? 0) + 1;
    }
  }
  const max = Math.max(...buckets, 1);
  return (
    <div className="chart-strip">
      <span>runs / 24h</span>
      <svg viewBox="0 0 120 28" style={{ color: "var(--accent)" }}>
        {buckets.map((v, i) => {
          const h = (v / max) * 24;
          return <rect key={i} x={i * 5} y={28 - h} width={4} height={h} fill="currentColor" opacity={i > 17 ? 1 : 0.4} />;
        })}
      </svg>
      <span style={{ color: "var(--text-dim)" }}>{runs.length} total</span>
    </div>
  );
}
