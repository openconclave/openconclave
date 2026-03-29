import { cn } from "@/lib/utils";
import type { Run } from "@openconclave/shared";

const statusColors: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  failure: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function RunHistoryTable({ runs }: { runs: Run[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Recent Runs</h3>
      </div>
      <div className="divide-y divide-border">
        {runs.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No runs yet. Trigger a workflow to get started.
          </p>
        )}
        {runs.map((run) => (
          <a
            href={`/runs/${run.id}`}
            key={run.id}
            className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  statusColors[run.status] ?? statusColors.queued
                )}
              >
                {run.status}
              </span>
              <span className="text-sm font-mono text-muted-foreground">
                {run.id.slice(0, 8)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
