import { Header } from "@/components/layout/header";
import { StatusCards } from "@/components/dashboard/status-cards";
import { RunHistoryTable } from "@/components/dashboard/run-history-table";
import { AgentActivityFeed } from "@/components/dashboard/agent-activity-feed";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DashboardResponse } from "@openconclave/shared";

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);

  useEffect(() => {
    api
      .get<DashboardResponse>("/dashboard")
      .then(setData)
      .catch(() => {
        // API not ready yet, use empty defaults
        setData({
          activeRuns: 0,
          totalWorkflows: 0,
          recentRuns: [],
          agentTasks: [],
        });
      });
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

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <StatusCards
          workflows={data.totalWorkflows}
          activeRuns={data.activeRuns}
          runningAgents={data.agentTasks.filter((t) => t.status === "running").length}
          completedToday={data.recentRuns.filter((r) => r.status === "success").length}
        />
        <div className="grid grid-cols-2 gap-6">
          <RunHistoryTable runs={data.recentRuns} />
          <AgentActivityFeed tasks={data.agentTasks} />
        </div>
      </div>
    </>
  );
}
