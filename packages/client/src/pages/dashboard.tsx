import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  Play,
  Activity,
  CheckCircle,
  DollarSign,
  Clock,
  XCircle,
  Ban,
  Zap,
  ArrowUpRight,
  Terminal,
  Square,
  Loader2,
  MessageSquare,
} from "lucide-react";

interface DashboardData {
  totalWorkflows: number;
  activeRuns: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  totalCost: number;
  recentRuns: Array<{ id: string; status: string; workflowId: string; createdAt: string }>;
  workflows: Array<{ id: string; name: string; enabled: boolean; toolName?: string; triggerType?: string }>;
  recentOutputs: Array<{ id: number; runId: string; nodeId: string; data: unknown; createdAt: string }>;
  schedule: Array<{ workflowId: string; cron: string; nextRun: string; enabled: boolean }>;
}

const STATUS_DOTS: Record<string, string> = {
  queued: "bg-muted-foreground",
  running: "bg-warning animate-pulse",
  success: "bg-success",
  failure: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  const hasActiveRuns = data ? data.activeRuns > 0 : false;

  useEffect(() => {
    const load = () => api.get<DashboardData>("/dashboard").then(setData).catch(() => {});
    load();
    // Poll faster when runs are active so stop buttons and status update promptly
    const interval = setInterval(load, hasActiveRuns ? 3000 : 10000);
    return () => clearInterval(interval);
  }, [hasActiveRuns]);

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Activity className="h-5 w-5 animate-pulse" />
          <span className="text-sm tracking-wide uppercase">Connecting</span>
        </div>
      </div>
    );
  }

  const successRate = data.totalRuns > 0
    ? Math.round((data.successCount / data.totalRuns) * 100)
    : 0;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header strip */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Operations</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.activeRuns > 0
                ? `${data.activeRuns} active run${data.activeRuns > 1 ? "s" : ""}`
                : "All systems idle"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "h-2 w-2 rounded-full",
              data.activeRuns > 0 ? "bg-success animate-pulse" : "bg-muted-foreground"
            )} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              {data.activeRuns > 0 ? "live" : "idle"}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Metrics Row */}
        <div className="grid grid-cols-5 gap-3">
          <MetricCard
            label="Workflows"
            value={data.totalWorkflows}
            icon={GitBranch}
            accent="oklch(0.65 0.18 260)"
          />
          <MetricCard
            label="Active"
            value={data.activeRuns}
            icon={Activity}
            accent="oklch(0.65 0.18 145)"
            pulse={data.activeRuns > 0}
          />
          <MetricCard
            label="Total Runs"
            value={data.totalRuns}
            icon={Zap}
            accent="oklch(0.65 0.15 230)"
          />
          <MetricCard
            label="Success"
            value={`${successRate}%`}
            icon={CheckCircle}
            accent="oklch(0.65 0.18 145)"
            subtitle={`${data.successCount} of ${data.totalRuns}`}
          />
          <MetricCard
            label="Cost"
            value={`$${data.totalCost.toFixed(2)}`}
            icon={DollarSign}
            accent="oklch(0.70 0.16 80)"
          />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-12 gap-5">

          {/* Run Distribution — spans 4 cols */}
          <div className="col-span-4 rounded-xl border border-border bg-card/50 p-5">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-5">
              Run Distribution
            </h3>
            <div className="space-y-4">
              <DistributionBar
                label="Success"
                value={data.successCount}
                total={data.totalRuns}
                color="bg-success"
                icon={<CheckCircle className="h-3.5 w-3.5 text-success" />}
              />
              <DistributionBar
                label="Failed"
                value={data.failureCount}
                total={data.totalRuns}
                color="bg-destructive"
                icon={<XCircle className="h-3.5 w-3.5 text-destructive" />}
              />
              <DistributionBar
                label="Cancelled"
                value={data.cancelledCount}
                total={data.totalRuns}
                color="bg-muted-foreground"
                icon={<Ban className="h-3.5 w-3.5 text-muted-foreground" />}
              />
            </div>
          </div>

          {/* Quick Launch — spans 4 cols */}
          <div className="col-span-4 rounded-xl border border-border bg-card/50 p-5">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-4">
              Quick Launch
            </h3>
            <div className="space-y-1">
              {data.workflows.map((wf) => {
                const activeRun = data.recentRuns.find(
                  (r) => String(r.workflowId) === String(wf.id) && (r.status === "running" || r.status === "queued")
                );
                const isChat = wf.triggerType === "chat";
                const reload = () => api.get<DashboardData>("/dashboard").then(setData).catch(() => {});
                return (
                  <div
                    key={wf.id}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-secondary/50",
                      activeRun && "bg-warning/5"
                    )}
                  >
                    {activeRun ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-warning" />
                    ) : (
                      <div className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0 transition-colors",
                        wf.enabled ? "bg-success" : "bg-muted-foreground/40"
                      )} />
                    )}
                    <a
                      href={activeRun ? `/runs/${activeRun.id}` : `/workflows/${wf.id}`}
                      className={cn(
                        "flex-1 text-sm truncate transition-colors group-hover:text-foreground",
                        activeRun ? "text-warning" : "text-muted-foreground"
                      )}
                    >
                      {wf.name}
                      {activeRun && (
                        <span className="text-[10px] text-warning/60 ml-1.5">#{activeRun.id}</span>
                      )}
                    </a>
                    {activeRun ? (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          api.post(`/runs/${activeRun.id}/cancel`, {}).then(reload).catch(() => {});
                        }}
                        className="shrink-0 flex h-7 items-center gap-1 rounded-md bg-destructive/20 text-destructive px-2 hover:bg-destructive/30 transition-colors"
                      >
                        <Square className="h-3 w-3" />
                        <span className="text-[11px] font-medium">Stop</span>
                      </button>
                    ) : wf.enabled ? (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (isChat && wf.toolName) {
                            window.open(`/${wf.toolName}/chat`, "_blank");
                          } else {
                            api.post(`/workflows/${wf.id}/run`, {}).then(reload).catch(() => {});
                          }
                        }}
                        className={cn(
                          "opacity-0 group-hover:opacity-100 shrink-0 flex h-7 items-center gap-1 rounded-md px-2 transition-all",
                          isChat
                            ? "bg-primary/10 text-primary hover:bg-primary/20"
                            : "bg-success/10 text-success hover:bg-success/20"
                        )}
                      >
                        {isChat ? <MessageSquare className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        <span className="text-[11px] font-medium">{isChat ? "Chat" : "Start"}</span>
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {data.workflows.length === 0 && (
                <div className="flex flex-col items-center py-6 text-muted-foreground/50">
                  <GitBranch className="h-8 w-8 mb-2" />
                  <p className="text-xs">No workflows</p>
                </div>
              )}
            </div>
          </div>

          {/* Schedules — spans 4 cols */}
          <div className="col-span-4 rounded-xl border border-border bg-card/50 p-5">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-4">
              Schedules
            </h3>
            <div className="space-y-3">
              {data.schedule.filter((s) => s.enabled).map((s) => {
                const wf = data.workflows.find((w) => w.id === s.workflowId);
                return (
                  <div key={s.workflowId} className="flex items-start gap-3">
                    <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-md bg-info/10">
                      <Clock className="h-3 w-3 text-info" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{wf?.name ?? s.workflowId.slice(0, 8)}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
                          {s.cron}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          next {new Date(s.nextRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {data.schedule.filter((s) => s.enabled).length === 0 && (
                <div className="flex flex-col items-center py-6 text-muted-foreground/50">
                  <Clock className="h-8 w-8 mb-2" />
                  <p className="text-xs">No schedules</p>
                </div>
              )}
            </div>
          </div>

          {/* Recent Runs — spans 7 cols */}
          <div className="col-span-7 rounded-xl border border-border bg-card/50">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Recent Runs
              </h3>
              <a
                href="/runs"
                className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
              >
                View all <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
            <div className="divide-y divide-border/50">
              {data.recentRuns.slice(0, 8).map((run) => {
                const wf = data.workflows.find((w) => w.id === run.workflowId);
                return (
                  <a
                    key={run.id}
                    href={`/runs/${run.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-secondary/30"
                  >
                    <div className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOTS[run.status] ?? STATUS_DOTS.queued)} />
                    <span className="text-sm flex-1 truncate text-muted-foreground">
                      {wf?.name ?? run.workflowId.slice(0, 8)}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      #{run.id}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 w-16 text-right">
                      {new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </a>
                );
              })}
              {data.recentRuns.length === 0 && (
                <p className="px-5 py-8 text-center text-xs text-muted-foreground/50">
                  No runs yet
                </p>
              )}
            </div>
          </div>

          {/* Recent Outputs — spans 5 cols */}
          <div className="col-span-5 rounded-xl border border-border bg-card/50">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Latest Outputs
              </h3>
            </div>
            <div className="divide-y divide-border/50">
              {data.recentOutputs.slice(0, 5).map((out) => {
                // Extract content from new { content, workflowName, nodeLabel } shape or legacy string
                const outData = out.data as Record<string, unknown> | string;
                const content = typeof outData === "string"
                  ? outData
                  : typeof outData?.content === "string"
                    ? outData.content
                    : JSON.stringify(outData);
                const workflowName = typeof outData === "object" && outData?.workflowName
                  ? String(outData.workflowName)
                  : null;

                return (
                  <a
                    key={out.id}
                    href={`/runs/${out.runId}`}
                    className="block px-5 py-3 transition-colors hover:bg-secondary/30"
                  >
                    {workflowName && (
                      <p className="text-[10px] font-medium text-primary/70 mb-1">{workflowName}</p>
                    )}
                    <div className="flex items-start gap-2">
                      <Terminal className="h-3 w-3 mt-1 text-primary shrink-0" />
                      <p className="text-xs line-clamp-2 text-muted-foreground leading-relaxed">
                        {content.slice(0, 200)}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground/50 mt-1.5 pl-5">
                      {new Date(out.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </a>
                );
              })}
              {data.recentOutputs.length === 0 && (
                <div className="flex flex-col items-center py-8 text-muted-foreground/50">
                  <Terminal className="h-8 w-8 mb-2" />
                  <p className="text-xs">No outputs yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
  subtitle,
  pulse,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
  subtitle?: string;
  pulse?: boolean;
}) {
  return (
    <div className="group relative rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-border/80 overflow-hidden">
      {/* Accent glow */}
      <div
        className="absolute -top-8 -right-8 h-20 w-20 rounded-full opacity-[0.07] blur-2xl transition-opacity group-hover:opacity-[0.12]"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-center justify-between relative">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon
          className={cn("h-4 w-4 opacity-40", pulse && "animate-pulse")}
          style={{ color: accent }}
        />
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight relative">{value}</p>
      {subtitle && (
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

function DistributionBar({
  label,
  value,
  total,
  color,
  icon,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  icon: React.ReactNode;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{value}</span>
          <span className="text-[10px] text-muted-foreground/50">{pct.toFixed(0)}%</span>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-secondary/50 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
    </div>
  );
}
