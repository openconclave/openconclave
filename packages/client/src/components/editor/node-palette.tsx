import { Zap, Cpu, GitFork, Code, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeType } from "@openconclave/shared";

const nodeTypes: {
  type: NodeType;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}[] = [
  { type: "trigger", label: "Trigger", icon: Zap, color: "bg-node-trigger", description: "Start a workflow" },
  { type: "agent", label: "Agent", icon: Cpu, color: "bg-node-agent", description: "AI agent task" },
  { type: "condition", label: "Condition", icon: GitFork, color: "bg-node-condition", description: "Branch logic" },
  { type: "transform", label: "Code", icon: Code, color: "bg-node-transform", description: "Run Python/Node/Bash" },
  { type: "output", label: "Output", icon: Send, color: "bg-node-output", description: "Send result" },
];

function getDefaultConfig(type: NodeType) {
  switch (type) {
    case "trigger": return { type: "manual" };
    case "agent": return { prompt: "", model: "sonnet" };
    case "condition": return { expression: "" };
    case "transform": return { runtime: "python", code: "" };
    case "output": return { type: "log", config: {} };
  }
}

export function NodePalette() {
  const onDragStart = (e: React.DragEvent, type: NodeType, label: string) => {
    const data = JSON.stringify({
      type,
      label,
      config: getDefaultConfig(type),
    });
    e.dataTransfer.setData("application/openconclave-node", data);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-52 border-r border-border bg-card p-3 space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3">
        Nodes
      </h3>
      {nodeTypes.map((nt) => (
        <div
          key={nt.type}
          draggable
          onDragStart={(e) => onDragStart(e, nt.type, nt.label)}
          className="flex items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5 cursor-grab active:cursor-grabbing hover:bg-secondary transition-colors"
        >
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded",
              nt.color
            )}
          >
            <nt.icon className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">{nt.label}</p>
            <p className="text-[10px] text-muted-foreground">{nt.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
