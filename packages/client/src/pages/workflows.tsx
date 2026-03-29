import { Header, NewButton } from "@/components/layout/header";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WorkflowDefinition, WorkflowListResponse } from "@openconclave/shared";
import { GitBranch, Pause, Play, Clock, Trash2 } from "lucide-react";
import { confirm } from "@/components/ui/confirm";

type ScheduleEntry = { workflowId: string; cron: string; nextRun: string; enabled: boolean };

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [schedule, setSchedule] = useState<Map<string, ScheduleEntry>>(new Map());

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

  useEffect(() => { load(); }, []);

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
              return (
                <a
                  key={wf.id}
                  href={`/workflows/${wf.id}`}
                  className={cn(
                    "rounded-lg border bg-card p-4 hover:border-primary/50 transition-colors",
                    wf.enabled ? "border-border" : "border-border opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold truncate flex-1">{wf.name}</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => toggleEnabled(e, wf)}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                          wf.enabled
                            ? "bg-success/20 text-success hover:bg-success/30"
                            : "bg-muted text-muted-foreground hover:bg-accent"
                        )}
                        title={wf.enabled ? "Pause workflow" : "Enable workflow"}
                      >
                        {wf.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={(e) => deleteWorkflow(e, wf.id, wf.name)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                        title="Delete workflow"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {wf.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      {wf.description}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{wf.nodes?.length ?? 0} nodes</span>
                    <span>&middot;</span>
                    <span className={wf.enabled ? "text-success" : "text-muted-foreground"}>
                      {wf.enabled ? "Active" : "Paused"}
                    </span>
                  </div>
                  {sched && sched.enabled && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-info">
                      <Clock className="h-3 w-3" />
                      <span>Next run: {new Date(sched.nextRun).toLocaleTimeString()}</span>
                      <span className="text-muted-foreground">({sched.cron})</span>
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
