import { Header } from "@/components/layout/header";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  Play,
  Cpu,
  CheckCircle,
  DollarSign,
  Clock,
  XCircle,
  AlertTriangle,
  Zap,
} from "lucide-react";

type DashboardData = {
  totalWorkflows: number;
  activeRuns: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  totalCost: number;
  recentRuns: any[];
  workflows: { id: string; name: string; enabled: boolean }[];
  recentOutputs: { id: number; runId: string; nodeId: string; data: any; createdAt: string }[];
  schedule: { workflowId: string; cron: string; nextRun: string; enabled: boolean }[];
};

const statusColors: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  failure: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/dashboard").then(setData).catch(() => {});
  }, []);

  if (!data) {
    return (
      <>
        <Header title="Dashboard" />
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </>
    );
  }

  const successRate = data.totalRuns > 0
    ? Math.round((data.successCount / data.totalRuns) * 100)
    : 0;

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {/* Status Cards */}
        <div className="grid grid-cols-5 gap-4">
          <StatCard label="Workflows" value={data.totalWorkflows} icon={GitBranch} color="text-node-agent" />
          <StatCard label="Active Runs" value={data.activeRuns} icon={Play} color="text-success" />
          <StatCard label="Total Runs" value={data.totalRuns} icon={Cpu} color="text-info" />
          <StatCard label="Success Rate" value={`${successRate}%`} icon={CheckCircle} color="text-success" />
          <StatCard label="Total Cost" value={`$${data.totalCost.toFixed(2)}`} icon={DollarSign} color="text-warning" />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-3 gap-6">
          {/* Success/Failure Chart */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-4">Run Results</h3>
            <div className="flex items-end gap-2 h-32">
              <Bar label="Success" value={data.successCount} max={data.totalRuns} color="bg-success" />
              <Bar label="Failed" value={data.failureCount} max={data.totalRuns} color="bg-destructive" />
              <Bar label="Cancelled" value={data.cancelledCount} max={data.totalRuns} color="bg-muted-foreground" />
            </div>
          </div>

          {/* Quick Launch */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Quick Launch</h3>
            <div className="space-y-1">
              {data.workflows.map((wf) => (
                <div key={wf.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/30 transition-colors">
                  <div className={cn("h-2 w-2 rounded-full shrink-0", wf.enabled ? "bg-success" : "bg-muted-foreground")} />
                  <a
                    href={`/workflows/${wf.id}`}
                    className="text-sm truncate flex-1 hover:text-primary transition-colors"
                  >
                    {wf.name}
                  </a>
                  {wf.enabled && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        api.post(`/workflows/${wf.id}/run`, {}).catch(() => {});
                      }}
                      className="shrink-0 flex h-6 w-6 items-center justify-center rounded bg-success/20 text-success hover:bg-success/30 transition-colors"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {data.workflows.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No workflows yet</p>
              )}
            </div>
          </div>

          {/* Active Schedules */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Active Schedules</h3>
            <div className="space-y-2 max-h-36 overflow-y-auto">
              {data.schedule.filter((s) => s.enabled).map((s) => {
                const wf = data.workflows.find((w) => w.id === s.workflowId);
                return (
                  <div key={s.workflowId} className="flex items-center gap-2">
                    <Clock className="h-3 w-3 text-info shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{wf?.name ?? s.workflowId.slice(0, 8)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        <span className="font-mono">{s.cron}</span>
                        <span className="ml-2">Next: {new Date(s.nextRun).toLocaleTimeString()}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
              {data.schedule.filter((s) => s.enabled).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No active schedules</p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Recent Runs */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Recent Runs</h3>
              <a href="/runs" className="text-xs text-primary hover:underline">View all</a>
            </div>
            <div className="divide-y divide-border">
              {data.recentRuns.slice(0, 10).map((run) => (
                <a
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                        statusColors[run.status] ?? statusColors.queued
                      )}
                    >
                      {run.status}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">{run.id.slice(0, 8)}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(run.createdAt).toLocaleTimeString()}
                  </span>
                </a>
              ))}
              {data.recentRuns.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">No runs yet</p>
              )}
            </div>
          </div>

          {/* Recent Outputs */}
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Recent Outputs</h3>
            </div>
            <div className="divide-y divide-border">
              {data.recentOutputs.map((out) => (
                <a
                  key={out.id}
                  href={`/runs/${out.runId}`}
                  className="block px-4 py-3 hover:bg-accent/30 transition-colors"
                >
                  <p className="text-sm line-clamp-2">
                    {typeof out.data === "string" ? out.data : JSON.stringify(out.data).slice(0, 120)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(out.createdAt).toLocaleTimeString()}
                  </p>
                </a>
              ))}
              {data.recentOutputs.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No outputs yet. Add a "Claude Code" or "Telegram" output node.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const height = max > 0 ? Math.max(4, (value / max) * 100) : 4;
  return (
    <div className="flex-1 flex flex-col items-center gap-1">
      <div className="w-full flex items-end h-24">
        <div
          className={cn("w-full rounded-t", color)}
          style={{ height: `${height}%` }}
        />
      </div>
      <span className="text-lg font-bold">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
