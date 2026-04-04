import { Header } from "@/components/layout/header";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Run } from "@openconclave/shared";
import { Play, Clock, DollarSign, Timer, ChevronLeft, ChevronRight, Square } from "lucide-react";

type RunWithMeta = Run & { totalCost?: number; durationMs?: number | null };

const PAGE_SIZE = 15;

const statusColors: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  failure: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function RunsPage() {
  const [runs, setRuns] = useState<RunWithMeta[]>([]);
  const [workflows, setWorkflows] = useState<Map<string, string>>(new Map());
  const [page, setPage] = useState(0);

  useEffect(() => {
    api
      .get<{ runs: RunWithMeta[] }>("/runs")
      .then((d) => setRuns(d.runs))
      .catch(() => setRuns([]));

    api
      .get<{ workflows: Array<{ id: string; name: string }> }>("/workflows")
      .then((d) => {
        const map = new Map<string, string>();
        for (const w of d.workflows) map.set(String(w.id), w.name);
        setWorkflows(map);
      })
      .catch(() => {});
  }, []);

  const reload = () => {
    api.get<{ runs: RunWithMeta[] }>("/runs").then((d) => setRuns(d.runs)).catch(() => {});
  };

  const handleCancel = async (e: React.MouseEvent, runId: number) => {
    e.preventDefault();
    e.stopPropagation();
    await api.post(`/runs/${runId}/cancel`, {});
    reload();
  };

  const totalPages = Math.ceil(runs.length / PAGE_SIZE);
  const pagedRuns = runs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
          <>
            <div className="space-y-2">
              {pagedRuns.map((run) => (
                <a
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium shrink-0",
                        statusColors[run.status] ?? statusColors.queued
                      )}
                    >
                      {run.status}
                    </span>
                    <span className="text-sm truncate">
                      {workflows.get(String(run.workflowId)) ?? "Unknown workflow"}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">
                      #{run.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 ml-4">
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
                    <span className="flex items-center gap-1 w-36 justify-end">
                      <Clock className="h-3 w-3" />
                      {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
                    </span>
                    {(run.status === "running" || run.status === "queued") && (
                      <button
                        onClick={(e) => handleCancel(e, run.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-white hover:bg-destructive/90 transition-colors"
                      >
                        <Square className="h-3 w-3" />
                        Stop
                      </button>
                    )}
                  </div>
                </a>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-1">
                <span className="text-xs text-muted-foreground">
                  {runs.length} runs &middot; page {page + 1} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
