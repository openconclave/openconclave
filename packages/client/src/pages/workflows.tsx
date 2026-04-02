import { Header, NewButton } from "@/components/layout/header";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WorkflowDefinition, WorkflowListResponse } from "@openconclave/shared";
import { GitBranch, Play, Clock, Trash2, Square, Loader2, Power, MessageSquare } from "lucide-react";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";

type ScheduleEntry = { workflowId: string; cron: string; nextRun: string; enabled: boolean };
type ActiveRun = { id: number; workflowId: number; status: string };

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [schedule, setSchedule] = useState<Map<string, ScheduleEntry>>(new Map());
  const [activeRuns, setActiveRuns] = useState<Map<string, ActiveRun>>(new Map());

  const load = () => {
    api
      .get<WorkflowListResponse>("/workflows")
      .then((d) =>
        setWorkflows(
          d.workflows.map((w: any) => ({
            ...w.definition,
            id: w.id,
            name: w.name,
            description: w.description,
            enabled: w.enabled,
          })) as WorkflowDefinition[]
        )
      )
      .catch(() => setWorkflows([]));

    api
      .get<{ schedule: ScheduleEntry[] }>("/scheduler")
      .then((d) => {
        const map = new Map<string, ScheduleEntry>();
        for (const s of d.schedule) map.set(s.workflowId, s);
        setSchedule(map);
      })
      .catch(() => setSchedule(new Map()));
  };

  const loadRuns = () => {
    api
      .get<{ runs: ActiveRun[] }>("/runs")
      .then((d) => {
        const map = new Map<string, ActiveRun>();
        for (const r of d.runs) {
          if (r.status === "running" || r.status === "queued") {
            const wfId = String(r.workflowId);
            if (!map.has(wfId)) map.set(wfId, r);
          }
        }
        setActiveRuns(map);
      })
      .catch(() => setActiveRuns(new Map()));
  };

  const handleStop = async (e: React.MouseEvent, run: ActiveRun) => {
    e.preventDefault();
    e.stopPropagation();
    await api.post(`/runs/${run.id}/cancel`, {});
    loadRuns();
  };

  useEffect(() => { load(); }, []);

  // Poll for active runs
  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 3000);
    return () => clearInterval(interval);
  }, []);

  const deleteWorkflow = async (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = await confirm("Delete workflow", `Are you sure you want to delete "${name}"? This cannot be undone.`);
    if (!confirmed) return;
    await api.delete(`/workflows/${id}`);
    load();
  };

  const toggleEnabled = async (e: React.MouseEvent, wf: WorkflowDefinition) => {
    e.preventDefault();
    e.stopPropagation();
    await api.put(`/workflows/${wf.id}`, { enabled: !wf.enabled });
    await api.post("/scheduler/sync", {});
    load();
  };

  const handleStart = (e: React.MouseEvent, wf: WorkflowDefinition) => {
    e.preventDefault();
    e.stopPropagation();
    const triggerNode = wf.nodes?.find((n: any) => (n.data?.type ?? n.type) === "trigger");
    const triggerConfig = (triggerNode?.data?.config ?? triggerNode?.config) as Record<string, unknown> | undefined;
    if (triggerConfig?.type === "chat") {
      const toolName = wf.toolName;
      if (toolName) {
        window.open(`/${toolName}/chat`, "_blank");
      } else {
        toast("Set a tool name first (in workflow settings) to use chat", "error");
      }
      return;
    }
    api.post(`/workflows/${wf.id}/run`, {})
      .then(() => { loadRuns(); toast(`Started ${wf.name}`, "success"); })
      .catch((err: any) => toast(`Failed: ${err.message}`, "error"));
  };

  return (
    <>
      <Header
        title="Workflows"
        actions={
          <NewButton
            label="New Workflow"
            onClick={() => (window.location.href = "/workflows/new")}
          />
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <GitBranch className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No workflows yet</p>
            <p className="text-sm mt-1">
              Create your first workflow to start orchestrating AI agents.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {workflows.map((wf) => {
              const sched = schedule.get(wf.id);
              const activeRun = activeRuns.get(String(wf.id));
              const triggerNode = wf.nodes?.find((n: any) => (n.data?.type ?? n.type) === "trigger");
              const isChat = (triggerNode?.data?.config as Record<string, unknown> | undefined)?.type === "chat";
              return (
                <a
                  key={wf.id}
                  href={`/workflows/${wf.id}`}
                  className={cn(
                    "rounded-lg border bg-card hover:border-primary/50 transition-colors flex flex-col",
                    wf.enabled ? "border-border" : "border-border opacity-60",
                    activeRun && "!border-warning/60 shadow-[0_0_12px_-2px] shadow-warning/30"
                  )}
                >
                  {/* Content */}
                  <div className="p-4 flex-1">
                    <h3 className="font-semibold truncate">{wf.name}</h3>
                    {wf.description && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {wf.description}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{wf.nodes?.length ?? 0} nodes</span>
                      <span>&middot;</span>
                      {activeRun ? (
                        <span className="flex items-center gap-1 text-warning">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Running (#{activeRun.id})
                        </span>
                      ) : (
                        <span className={wf.enabled ? "text-success" : "text-muted-foreground"}>
                          {wf.enabled ? "Active" : "Disabled"}
                        </span>
                      )}
                    </div>
                    {sched && sched.enabled && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-info">
                        <Clock className="h-3 w-3" />
                        <span>Next run: {new Date(sched.nextRun).toLocaleTimeString()}</span>
                        <span className="text-muted-foreground">({sched.cron})</span>
                      </div>
                    )}
                  </div>

                  {/* Action bar */}
                  <div className="border-t border-border/50 px-3 py-2 flex items-center gap-1.5">
                    {activeRun ? (
                      <button
                        onClick={(e) => handleStop(e, activeRun)}
                        className="flex h-7 items-center gap-1.5 rounded-md bg-destructive/15 text-destructive px-2.5 hover:bg-destructive/25 transition-colors"
                        title="Stop running workflow"
                      >
                        <Square className="h-3 w-3" />
                        <span className="text-[11px] font-medium">Stop</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleStart(e, wf)}
                        className={cn(
                          "flex h-7 items-center gap-1.5 rounded-md px-2.5 transition-colors",
                          isChat
                            ? "bg-primary/15 text-primary hover:bg-primary/25"
                            : "bg-success/15 text-success hover:bg-success/25"
                        )}
                        title={isChat ? "Open chat" : "Start workflow"}
                      >
                        {isChat ? <MessageSquare className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        <span className="text-[11px] font-medium">{isChat ? "Chat" : "Start"}</span>
                      </button>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={(e) => toggleEnabled(e, wf)}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                        wf.enabled
                          ? "text-success hover:bg-success/15"
                          : "text-muted-foreground/50 hover:bg-muted"
                      )}
                      title={wf.enabled ? "Disable workflow" : "Enable workflow"}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => deleteWorkflow(e, wf.id, wf.name)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-destructive/15 hover:text-destructive transition-colors"
                      title="Delete workflow"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
