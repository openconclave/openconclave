import type { AgentTask } from "@openconclave/shared";
import { cn } from "@/lib/utils";

const statusDot: Record<string, string> = {
  queued: "bg-muted-foreground",
  running: "bg-warning animate-pulse",
  success: "bg-success",
  failure: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

export function AgentActivityFeed({ tasks }: { tasks: AgentTask[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Agent Activity</h3>
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {tasks.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No agent activity yet.
          </p>
        )}
        {tasks.map((task) => (
          <div key={task.id} className="flex items-start gap-3 px-4 py-3">
            <div
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                statusDot[task.status] ?? statusDot.queued
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">{task.prompt}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {task.model ?? "sonnet"} &middot; {task.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
