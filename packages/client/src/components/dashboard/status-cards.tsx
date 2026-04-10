import { GitBranch, Play, Cpu, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type CardProps = {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
};

function StatusCard({ label, value, icon: Icon, color }: CardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={cn("h-5 w-5", color)} />
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

export function StatusCards({
  conclaves = 0,
  activeRuns = 0,
  runningAgents = 0,
  completedToday = 0,
}: {
  conclaves?: number;
  activeRuns?: number;
  runningAgents?: number;
  completedToday?: number;
}) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <StatusCard
        label="Conclaves"
        value={conclaves}
        icon={GitBranch}
        color="text-node-agent"
      />
      <StatusCard
        label="Active Runs"
        value={activeRuns}
        icon={Play}
        color="text-success"
      />
      <StatusCard
        label="Running Agents"
        value={runningAgents}
        icon={Cpu}
        color="text-warning"
      />
      <StatusCard
        label="Completed Today"
        value={completedToday}
        icon={CheckCircle}
        color="text-info"
      />
    </div>
  );
}
