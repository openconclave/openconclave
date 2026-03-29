import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Run, AgentTask, RunEvent } from "@openconclave/shared";
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Brain,
  Cpu,
  Zap,
  DollarSign,
  Timer,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type RunDetail = {
  run: Run;
  tasks: AgentTask[];
  events: RunEvent[];
};

const statusIcon: Record<string, React.ReactNode> = {
  queued: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 text-warning animate-spin" />,
  success: <CheckCircle className="h-4 w-4 text-success" />,
  failure: <XCircle className="h-4 w-4 text-destructive" />,
  cancelled: <Clock className="h-4 w-4 text-muted-foreground" />,
};

const statusBadge: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  failure: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function RunDetailPage() {
  const [data, setData] = useState<RunDetail | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<string[]>([]);
  const [expandedEvents, setExpandedEvents] = useState(false);
  const [expandedEventIds, setExpandedEventIds] = useState<number[]>([]);

  const toggleEvent = (id: number) => {
    setExpandedEventIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const path = window.location.pathname;
  const runId = path.split("/runs/")[1];

  useEffect(() => {
    if (!runId) return;

    const load = () => {
      api
        .get<RunDetail>(`/runs/${runId}`)
        .then(setData)
        .catch(() => setData(null));
    };

    load();

    // Poll every 2s while run is active
    const interval = setInterval(() => {
      if (data?.run.status === "running" || data?.run.status === "queued" || !data) {
        load();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runId, data?.run.status]);

  const toggleTask = (id: string) => {
    setExpandedTasks((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  if (!data) {
    return (
      <>
        <Header title="Run Details" />
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </>
    );
  }

  const { run, tasks, events } = data;
  const duration =
    run.startedAt && run.completedAt
      ? ((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)
      : null;
  const totalCost = tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

  return (
    <>
      <Header title="Run Details" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Run Summary */}
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-4">
            {statusIcon[run.status]}
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                statusBadge[run.status]
              )}
            >
              {run.status}
            </span>
            <span className="font-mono text-sm text-muted-foreground">{run.id}</span>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-node-trigger" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Trigger</p>
                <p className="text-sm">{run.triggerType ?? "manual"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-info" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Duration</p>
                <p className="text-sm">{duration ? `${duration}s` : "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-node-agent" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Agent Tasks</p>
                <p className="text-sm">{tasks.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-warning" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Cost</p>
                <p className="text-sm">{totalCost > 0 ? `$${totalCost.toFixed(4)}` : "—"}</p>
              </div>
            </div>
          </div>

          {run.error && (
            <div className="mt-4 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {run.error}
            </div>
          )}

          <div className="mt-4 text-xs text-muted-foreground">
            Started: {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
            {run.completedAt && <span className="ml-4">Completed: {new Date(run.completedAt).toLocaleString()}</span>}
          </div>
        </div>

        {/* Agent Tasks */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Agent Tasks ({tasks.length})</h3>
          </div>
          <div className="divide-y divide-border">
            {tasks.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No agent tasks in this run.
              </p>
            )}
            {tasks.map((task) => (
              <div key={task.id}>
                <button
                  onClick={() => toggleTask(task.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors"
                >
                  {expandedTasks.includes(task.id) ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  {statusIcon[task.status]}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{task.prompt}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {task.model ?? "sonnet"}
                      {task.costUsd != null && <span className="ml-2">${task.costUsd.toFixed(4)}</span>}
                      {task.startedAt && task.completedAt && (
                        <span className="ml-2">
                          {((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000).toFixed(1)}s
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                      statusBadge[task.status]
                    )}
                  >
                    {task.status}
                  </span>
                </button>

                {expandedTasks.includes(task.id) && (
                  <div className="border-t border-border bg-background px-6 py-4 space-y-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">Prompt</p>
                      <p className="text-sm bg-secondary/50 rounded-md px-3 py-2">{task.prompt}</p>
                    </div>
                    {task.systemPrompt && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-1">System Prompt</p>
                        <p className="text-sm bg-secondary/50 rounded-md px-3 py-2">{task.systemPrompt}</p>
                      </div>
                    )}
                    {task.input && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-1">Input</p>
                        <pre className="text-xs bg-secondary/50 rounded-md px-3 py-2 overflow-x-auto font-mono">
                          {typeof task.input === "string" ? task.input : JSON.stringify(task.input, null, 2)}
                        </pre>
                      </div>
                    )}
                    {/* Thinking blocks */}
                    {(() => {
                      const thinkingEvent = events.find(
                        (e) => e.type === "agent:thinking" && (e.data as Record<string, unknown>)?.taskId === task.id
                      );
                      if (!thinkingEvent) return null;
                      const thinkingData = thinkingEvent.data as { thinking: { thinking: string }[] };
                      return (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center gap-1">
                            <Brain className="h-3 w-3 text-node-transform" />
                            Thinking
                          </p>
                          <div className="space-y-2">
                            {thinkingData.thinking.map((block, i) => (
                              <pre
                                key={i}
                                className="text-xs bg-node-transform/10 border border-node-transform/20 rounded-md px-3 py-2 overflow-x-auto font-mono whitespace-pre-wrap text-muted-foreground"
                              >
                                {block.thinking}
                              </pre>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {task.output && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-1">Output</p>
                        <pre className="text-xs bg-secondary/50 rounded-md px-3 py-2 overflow-x-auto font-mono whitespace-pre-wrap">
                          {typeof task.output === "string" ? task.output : JSON.stringify(task.output, null, 2)}
                        </pre>
                      </div>
                    )}
                    {task.error && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-1">Error</p>
                        <pre className="text-xs bg-destructive/10 text-destructive rounded-md px-3 py-2 overflow-x-auto font-mono whitespace-pre-wrap">
                          {task.error}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Events Timeline */}
        <div className="rounded-lg border border-border bg-card">
          <button
            onClick={() => setExpandedEvents(!expandedEvents)}
            className="flex w-full items-center gap-2 border-b border-border px-4 py-3 hover:bg-accent/30 transition-colors"
          >
            {expandedEvents ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <h3 className="text-sm font-semibold">Events ({events.length})</h3>
          </button>
          {expandedEvents && (
            <div className="divide-y divide-border">
              {events.map((event) => (
                <div key={event.id}>
                  <button
                    onClick={() => toggleEvent(event.id)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
                  >
                    {expandedEventIds.includes(event.id) ? (
                      <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {event.type === "agent:thinking" && <Brain className="h-3 w-3 text-node-transform shrink-0" />}
                        <span className={cn("text-xs font-mono font-medium", event.type === "agent:thinking" && "text-node-transform")}>{event.type}</span>
                        {event.nodeId && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {event.nodeId}
                          </span>
                        )}
                      </div>
                      {event.data && !expandedEventIds.includes(event.id) && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {typeof event.data === "string"
                            ? event.data.slice(0, 120)
                            : JSON.stringify(event.data).slice(0, 120)}
                          ...
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </span>
                  </button>
                  {expandedEventIds.includes(event.id) && event.data && (
                    <div className="border-t border-border bg-background px-8 py-3">
                      <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto text-muted-foreground">
                        {typeof event.data === "string"
                          ? event.data
                          : JSON.stringify(event.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
