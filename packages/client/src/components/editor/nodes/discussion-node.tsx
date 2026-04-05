import { useCallback, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Users, Code, Cpu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useNodeData } from "@/hooks/use-node-data";
import type { DiscussionConfig, DiscussionModeratorConfig, AgentConfig, CodeConfig } from "@openconclave/shared";

// ── Shared handle/border styles matching base-node.tsx ───────

const handleBase = "!h-3 !w-3 !rounded-full !border-2 !bg-card transition-colors";

// cyan / blue — same as base-node handleColors[0] and handleColors[1]
const handleCyan = "!border-[oklch(0.65_0.18_200)] hover:!bg-[oklch(0.65_0.18_200/0.3)]";
const handleBlue = "!border-[oklch(0.65_0.18_260)] hover:!bg-[oklch(0.65_0.18_260/0.3)]";

// ── Moderator slot ────────────────────────────────────────────

interface ModeratorSlotProps {
  moderator: DiscussionModeratorConfig | undefined;
  onClear: () => void;
  isDragOver: boolean;
}

function ModeratorSlot({ moderator, onClear, isDragOver }: ModeratorSlotProps) {
  if (!moderator) {
    return (
      <div
        className={cn(
          "rounded-lg border-2 border-dashed px-3 py-2.5 text-center transition-colors",
          isDragOver
            ? "border-node-discussion/70 bg-node-discussion/10"
            : "border-border/50 hover:border-border"
        )}
      >
        <p className="text-[10px] text-muted-foreground leading-snug">
          {isDragOver ? "Drop to set moderator" : "Drop an Agent or Code node here"}
        </p>
      </div>
    );
  }

  const isCode = moderator.type === "code";
  const Icon = isCode ? Code : Cpu;
  const badge = isCode ? "Code" : "Agent";
  const badgeClass = isCode
    ? "bg-node-transform/20 text-node-transform"
    : "bg-node-agent/20 text-node-agent";

  return (
    <div className="flex items-center gap-2 rounded-lg border border-node-discussion/30 bg-node-discussion/5 px-2.5 py-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-node-discussion/20">
        <Icon className="h-3 w-3 text-node-discussion" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium">{moderator.node.label}</p>
        <span className={cn("rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide", badgeClass)}>
          {badge}
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        aria-label="Remove moderator"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Discussion Node ───────────────────────────────────────────

export function DiscussionNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as DiscussionConfig;

  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const edges = useWorkflowStore((s) => s.edges);

  const isActive = activeNodeIds.has(props.id);

  // Participants connect TO the "participants" target handle on the left side.
  const participantCount = edges.filter(
    (e) => e.target === props.id && e.targetHandle === "participants"
  ).length;

  const [dragOver, setDragOver] = useState(false);

  const clearModerator = useCallback(() => {
    // store.ts:145 does `{ ...n.data.config, ...configUpdate }` — a one-level spread.
    // That spread already preserves every existing config field not present in configUpdate.
    // Passing only `{ moderator: undefined }` is exactly what we need; no re-spreading required.
    updateNodeConfig(props.id, { moderator: undefined });
  }, [props.id, updateNodeConfig]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/openconclave-node")) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const raw = e.dataTransfer.getData("application/openconclave-node");
      if (!raw) return;

      // VETO-2 type guard: validate shape before touching state.
      // Synthetic DragEvents from DevTools cannot inject arbitrary config this way.
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("type" in parsed) ||
        !("label" in parsed) ||
        !("config" in parsed) ||
        // config must be an object — null config would crash inspector on every render
        typeof parsed.config !== "object" ||
        parsed.config === null ||
        // Only agent and transform (code) nodes are valid moderators
        (parsed.type !== "agent" && parsed.type !== "transform") ||
        typeof parsed.label !== "string" ||
        !parsed.label.trim()
      ) {
        return;
      }

      const { type: nodeType, label, config: dropConfig } = parsed as {
        type: "agent" | "transform";
        label: string;
        config: AgentConfig | CodeConfig;
      };

      const moderatorType: "code" | "agent" = nodeType === "transform" ? "code" : "agent";

      // store.ts:145 shallow merge preserves prompt/maxRounds/tool automatically.
      updateNodeConfig(props.id, {
        moderator: {
          type: moderatorType,
          node: { label, type: nodeType, config: dropConfig },
        },
      });
    },
    [props.id, updateNodeConfig]
  );

  return (
    <div
      // [&>*]:pointer-events-none during drag prevents dragleave flicker:
      // without it, moving the cursor onto a child element fires dragleave on the parent.
      className={cn(dragOver && "[&>*]:pointer-events-none")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={cn(
          "w-[260px] rounded-xl border bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
          "border-node-discussion/60",
          "shadow-[0_0_15px_-3px] shadow-node-discussion/20",
          props.selected && "!border-primary ring-1 ring-primary/30 ring-offset-1 ring-offset-background",
          isActive && "[animation:node-running_1.5s_ease-in-out_infinite] !border-warning"
        )}
        onClick={() => setSelectedNode(props.id)}
      >
        {/* Top handle — data input from upstream */}
        <Handle
          type="target"
          id="top"
          position={Position.Top}
          style={{ left: "50%" }}
          className={cn(handleBase, handleCyan)}
        />

        {/* Left handle — participant agents connect here.
            BUG-3 fix: no children inside Handle (causes layout anomalies at non-100% zoom).
            The participant count in the header subtitle conveys the same information. */}
        <Handle
          type="target"
          id="participants"
          position={Position.Left}
          style={{ top: "50%" }}
          className={cn(handleBase, handleBlue)}
        />

        {/* Bottom handle — output to downstream */}
        <Handle
          type="source"
          id="bottom"
          position={Position.Bottom}
          style={{ left: "50%" }}
          className={cn(handleBase, handleCyan)}
        />

        {/* Header */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-node-discussion">
            <Users className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{data.label}</span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {participantCount === 0
                ? "no participants"
                : participantCount === 1
                  ? "1 participant"
                  : `${participantCount} participants`}
            </span>
          </div>
        </div>

        {/* Moderator slot */}
        <div className="border-t border-border/40 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
            Moderator
          </p>
          <ModeratorSlot
            moderator={config.moderator}
            onClear={clearModerator}
            isDragOver={dragOver}
          />
        </div>

        {/* Footer: max rounds badge */}
        <div className="border-t border-border/40 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/60">Max rounds</span>
            <span className="rounded-full bg-node-discussion/15 px-2 py-0.5 text-[10px] font-semibold text-node-discussion">
              {config.maxRounds ?? 3}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
