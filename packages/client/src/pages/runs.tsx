import { Header } from "@/components/layout/header";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Run } from "@openconclave/shared";
import { Play, Clock, DollarSign, Timer } from "lucide-react";

type RunWithMeta = Run & { totalCost?: number; durationMs?: number | null };

const statusColors: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  failure: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function RunsPage() {
  const [runs, setRuns] = useState<RunWithMeta[]>([]);

  useEffect(() => {
    api
      .get<{ runs: RunWithMeta[] }>("/runs")
      .then((d) => setRuns(d.runs))
      .catch(() => setRuns([]));
  }, []);

  return (
    <>
      <Header title="Runs" />
      <div className="flex-1 overflow-y-auto p-6">
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Play className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No runs yet</p>
            <p className="text-sm mt-1">Trigger a workflow to see runs here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <a
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                      statusColors[run.status] ?? statusColors.queued
                    )}
                  >
                    {run.status}
                  </span>
                  <span className="text-sm font-mono">{run.id.slice(0, 12)}...</span>
                  <span className="text-xs text-muted-foreground">{run.workflowId.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {run.durationMs != null && (
                    <span className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {(run.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    {run.totalCost ? `$${run.totalCost.toFixed(4)}` : "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
