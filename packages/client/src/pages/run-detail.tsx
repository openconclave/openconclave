import { useEffect, useState } from "react";
import Markdown from "react-markdown";
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
  AlertTriangle,
  Square,
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
  interrupted: <AlertTriangle className="h-4 w-4 text-warning" />,
};

const statusBadge: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  failure: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  interrupted: "bg-warning/20 text-warning",
};

// ── Markdown wrapper ────────────────────────────────────────

function Md({ children }: { children: string }) {
  return (
    <Markdown
      components={{
        // Tailwind prose-like styling for inline markdown
        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children }) => (
          <code className="rounded bg-secondary px-1 py-0.5 text-[11px] font-mono">{children}</code>
        ),
        ul: ({ children }) => <ul className="ml-4 list-disc space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="ml-4 list-decimal space-y-0.5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h1 className="text-base font-bold mt-2 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-1.5 mb-0.5">{children}</h3>,
        pre: ({ children }) => (
          <pre className="rounded-md bg-secondary/70 px-3 py-2 text-xs overflow-x-auto">{children}</pre>
        ),
        a: ({ href, children }) => (
          <a href={href} className="text-info underline" target="_blank" rel="noopener noreferrer">{children}</a>
        ),
      }}
    >
      {children}
    </Markdown>
  );
}

// ── Event grouping ──────────────────────────────────────────

interface EventGroup {
  nodeId: string | null;
  label: string;
  events: RunEvent[];
}

function groupEventsByNode(events: RunEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let current: EventGroup | null = null;

  for (const event of events) {
    const nodeId = event.nodeId ?? null;

    // run-level events (run:started, run:completed) get their own group
    if (!nodeId) {
      if (current && current.nodeId === null) {
        current.events.push(event);
      } else {
        current = { nodeId: null, label: "run", events: [event] };
        groups.push(current);
      }
      continue;
    }

    // Group consecutive events for the same node
    if (current && current.nodeId === nodeId) {
      current.events.push(event);
    } else {
      current = { nodeId, label: nodeId, events: [event] };
      groups.push(current);
    }
  }

  return groups;
}

// Friendly event type labels
const eventTypeLabels: Record<string, string> = {
  "run:started": "Run started",
  "run:completed": "Run completed",
  "node:started": "Started",
  "node:completed": "Completed",
  "node:failed": "Failed",
  "agent:started": "Agent spawned",
  "agent:output": "Agent output",
  "agent:thinking": "Thinking",
  "agent:completed": "Agent finished",
  "channel:output": "Channel output",
  "prompt:question": "Channel question",
};

const eventTypeColor: Record<string, string> = {
  "run:started": "text-info",
  "run:completed": "text-success",
  "node:started": "text-muted-foreground",
  "node:completed": "text-success",
  "node:failed": "text-destructive",
  "agent:started": "text-node-agent",
  "agent:output": "text-muted-foreground",
  "agent:thinking": "text-node-transform",
  "agent:completed": "text-success",
  "channel:output": "text-warning",
  "prompt:question": "text-warning",
};

function formatEventData(event: RunEvent): string | null {
  if (!event.data) return null;
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case "agent:started":
      return `Engine: ${data.engine ?? "claude"}`;
    case "agent:completed":
      return `${data.success ? "Success" : "Failed"} in ${((data.durationMs as number) / 1000).toFixed(1)}s`;
    case "agent:output": {
      const chunk = data.chunk as string | undefined;
      if (!chunk) return null;
      // Clean up thinking prefix for display
      if (chunk.startsWith("[thinking:")) {
        return chunk.slice(0, 150) + (chunk.length > 150 ? "..." : "");
      }
      return chunk.slice(0, 200) + (chunk.length > 200 ? "..." : "");
    }
    case "agent:thinking":
      return null; // Shown separately in task detail
    case "node:completed": {
      const str = typeof data === "string" ? data : JSON.stringify(data);
      return str.length > 200 ? str.slice(0, 200) + "..." : str;
    }
    case "run:completed":
      return `Status: ${data.status}${data.error ? ` — ${data.error}` : ""}`;
    default:
      return null;
  }
}

// ── Page ────────────────────────────────────────────────────

export function RunDetailPage() {
  const [data, setData] = useState<RunDetail | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(new Map());
  const [expandedTasks, setExpandedTasks] = useState<string[]>([]);
  const [expandedEvents, setExpandedEvents] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<number[]>([]);
  const [expandedEventIds, setExpandedEventIds] = useState<number[]>([]);

  const path = window.location.pathname;
  const runId = path.split("/runs/")[1];

  useEffect(() => {
    if (!runId) return;

    const load = () => {
      api
        .get<RunDetail>(`/runs/${runId}`)
        .then((d) => {
          setData(d);
          // Fetch workflow to resolve node labels
          if (d.run.workflowId && nodeLabels.size === 0) {
            api.get<any>(`/workflows/${d.run.workflowId}`).then((wf) => {
              const def = wf.definition ?? wf;
              const labels = new Map<string, string>();
              for (const n of def.nodes ?? []) {
                labels.set(n.id, n.data?.label ?? n.id);
              }
              setNodeLabels(labels);
            }).catch(() => {});
          }
        })
        .catch(() => setData(null));
    };

    load();

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

  const toggleGroup = (idx: number) => {
    setExpandedGroups((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const toggleEvent = (id: number) => {
    setExpandedEventIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const isActive = data?.run.status === "running" || data?.run.status === "queued";

  const handleCancel = async () => {
    if (!runId) return;
    try {
      await api.post(`/runs/${runId}/cancel`, {});
      // Reload to reflect new status
      api.get<RunDetail>(`/runs/${runId}`).then(setData);
    } catch {}
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
  const eventGroups = groupEventsByNode(events);

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
            {isActive && (
              <button
                onClick={handleCancel}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1 text-xs font-medium text-white hover:bg-destructive/90 transition-colors"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            )}
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
                    {nodeLabels.get(task.nodeId) && (
                      <span className="text-[10px] font-medium text-primary/70">{nodeLabels.get(task.nodeId)}</span>
                    )}
                    <div className="text-sm truncate">
                      <Md>{typeof task.prompt === "string" ? task.prompt.split("\n")[0] : String(task.prompt)}</Md>
                    </div>
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
                      <div className="text-sm bg-secondary/50 rounded-md px-3 py-2">
                        <Md>{typeof task.prompt === "string" ? task.prompt : JSON.stringify(task.prompt)}</Md>
                      </div>
                    </div>
                    {task.systemPrompt && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-1">System Prompt</p>
                        <div className="text-sm bg-secondary/50 rounded-md px-3 py-2">
                          <Md>{task.systemPrompt}</Md>
                        </div>
                      </div>
                    )}
                    {task.input && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase mb-1">Input</p>
                        <pre className="text-xs bg-secondary/50 rounded-md px-3 py-2 overflow-x-auto font-mono whitespace-pre-wrap">
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
                        <div className="text-sm bg-secondary/50 rounded-md px-3 py-2 overflow-x-auto">
                          <Md>{typeof task.output === "string" ? task.output : JSON.stringify(task.output, null, 2)}</Md>
                        </div>
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

        {/* Events Timeline — grouped by node */}
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
              {eventGroups.map((group, groupIdx) => {
                const isGroupExpanded = expandedGroups.includes(groupIdx);
                const firstTime = new Date(group.events[0].createdAt).toLocaleTimeString();
                const lastTime = group.events.length > 1
                  ? new Date(group.events[group.events.length - 1].createdAt).toLocaleTimeString()
                  : null;

                // Determine group status from events
                const hasFailed = group.events.some((e) => e.type.includes("failed"));
                const hasCompleted = group.events.some((e) => e.type.includes("completed"));
                const groupColor = hasFailed
                  ? "border-l-destructive"
                  : hasCompleted
                  ? "border-l-success"
                  : "border-l-muted-foreground";

                return (
                  <div key={groupIdx} className={cn("border-l-2", groupColor)}>
                    <button
                      onClick={() => toggleGroup(groupIdx)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
                    >
                      {isGroupExpanded ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-xs font-mono font-medium text-foreground">
                        {group.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {group.events.length} event{group.events.length !== 1 ? "s" : ""}
                      </span>
                      <span className="flex-1" />
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {firstTime}{lastTime && lastTime !== firstTime ? ` → ${lastTime}` : ""}
                      </span>
                    </button>

                    {isGroupExpanded && (
                      <div className="border-t border-border/50 bg-background/50">
                        {group.events.map((event) => {
                          const isEventExpanded = expandedEventIds.includes(event.id);
                          const summary = formatEventData(event);

                          return (
                            <div key={event.id}>
                              <button
                                onClick={() => toggleEvent(event.id)}
                                className="flex w-full items-start gap-3 pl-10 pr-4 py-2 text-left hover:bg-accent/20 transition-colors"
                              >
                                {event.data ? (
                                  isEventExpanded ? (
                                    <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                  )
                                ) : (
                                  <span className="w-3 shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {event.type === "agent:thinking" && <Brain className="h-3 w-3 text-node-transform shrink-0" />}
                                    <span className={cn("text-xs font-medium", eventTypeColor[event.type] ?? "text-muted-foreground")}>
                                      {eventTypeLabels[event.type] ?? event.type}
                                    </span>
                                  </div>
                                  {summary && !isEventExpanded && (
                                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                      {summary}
                                    </p>
                                  )}
                                </div>
                                <span className="shrink-0 text-[10px] text-muted-foreground font-mono">
                                  {new Date(event.createdAt).toLocaleTimeString()}
                                </span>
                              </button>
                              {isEventExpanded && event.data && (
                                <div className="border-t border-border/30 bg-background pl-16 pr-6 py-3">
                                  <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto text-muted-foreground">
                                    {typeof event.data === "string"
                                      ? event.data
                                      : JSON.stringify(event.data, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
