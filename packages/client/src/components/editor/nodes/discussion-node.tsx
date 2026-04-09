import { useCallback, useState, useRef, useEffect, useLayoutEffect } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Users, Code, Cpu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useNodeData } from "@/hooks/use-node-data";
import type { DiscussionConfig, DiscussionModeratorConfig, AgentConfig, CodeConfig } from "@openconclave/shared";

const GRID = 20;

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
          "rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors",
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
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
  const isDraggingTool = useWorkflowStore((s) => s.isDraggingTool);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const edges = useWorkflowStore((s) => s.edges);

  const isActive = activeNodeIds.has(props.id);

  const [editing, setEditing] = useState(false);
  const labelRef = useRef<HTMLSpanElement>(null);

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  }, []);

  const commitRename = useCallback(() => {
    const el = labelRef.current;
    if (!el) return;
    const trimmed = (el.textContent ?? "").trim();
    if (trimmed && trimmed !== data.label) {
      updateNodeData(props.id, { label: trimmed });
    } else {
      el.textContent = data.label;
    }
    setEditing(false);
  }, [data.label, props.id, updateNodeData]);

  useEffect(() => {
    if (editing && labelRef.current) {
      labelRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(labelRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]);

  // Participants connect TO the "participants" target handle on the left side.
  const participantCount = edges.filter(
    (e) => e.target === props.id && e.targetHandle === "participants"
  ).length;

  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const dragCountRef = useRef(0);

  const clearModerator = useCallback(() => {
    updateNodeConfig(props.id, { moderator: undefined });
  }, [props.id, updateNodeConfig]);

  // Native DOM event listeners bypass React Flow's synthetic event interception.
  // React Flow v12 registers pane-level handlers via native listeners, so React's
  // e.stopPropagation() on synthetic events doesn't prevent the canvas onDrop from
  // also firing. Native stopImmediatePropagation() does.
  //
  // Counter-based dragenter/dragleave eliminates flicker caused by child elements:
  // each child enter increments, each leave decrements — only reset at zero.
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    const getNodeId = () => props.id;
    const getUpdateFn = () => updateNodeConfig;

    const isNodeDrag = (dt: DataTransfer | null) =>
      dt?.types.includes("application/openconclave-node") ?? false;

    const handleDragOver = (e: DragEvent) => {
      if (!isNodeDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      e.dataTransfer!.dropEffect = "move";
    };

    const handleDragEnter = (e: DragEvent) => {
      if (!isNodeDrag(e.dataTransfer)) return;
      e.preventDefault();
      dragCountRef.current++;
      if (dragCountRef.current === 1) setDragOver(true);
    };

    const handleDragLeave = (_e: DragEvent) => {
      dragCountRef.current--;
      if (dragCountRef.current <= 0) {
        dragCountRef.current = 0;
        setDragOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      dragCountRef.current = 0;
      setDragOver(false);

      const raw = e.dataTransfer?.getData("application/openconclave-node");
      if (!raw) return;

      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }

      if (
        typeof parsed !== "object" || parsed === null ||
        !("type" in parsed) || !("label" in parsed) || !("config" in parsed) ||
        typeof parsed.config !== "object" || parsed.config === null ||
        (parsed.type !== "agent" && parsed.type !== "transform" && parsed.type !== "code") ||
        typeof parsed.label !== "string" || !parsed.label.trim()
      ) return;

      const { type: nodeType, label, config: dropConfig } = parsed as {
        type: "agent" | "transform" | "code";
        label: string;
        config: AgentConfig | CodeConfig;
      };

      const moderatorType: "code" | "agent" = (nodeType === "transform" || nodeType === "code") ? "code" : "agent";

      getUpdateFn()(getNodeId(), {
        moderator: {
          type: moderatorType,
          node: { label, type: nodeType, config: dropConfig },
        },
      });
    };

    el.addEventListener("dragover", handleDragOver);
    el.addEventListener("dragenter", handleDragEnter);
    el.addEventListener("dragleave", handleDragLeave);
    el.addEventListener("drop", handleDrop);
    return () => {
      el.removeEventListener("dragover", handleDragOver);
      el.removeEventListener("dragenter", handleDragEnter);
      el.removeEventListener("dragleave", handleDragLeave);
      el.removeEventListener("drop", handleDrop);
    };
  }, [props.id, updateNodeConfig]);

  const nodeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    el.style.height = "";
    const h = el.offsetHeight;
    el.style.height = `${Math.ceil(h / (GRID * 2)) * (GRID * 2)}px`;
  }, [data.label, config.moderator]);

  return (
    <div ref={dropRef}>
      <div
        ref={nodeRef}
        className={cn(
          "w-[280px] rounded-2xl border-[1.5px] bg-gradient-to-b from-card to-card/80 transition-[border-color,box-shadow,opacity,filter] duration-200 cursor-pointer flex flex-col",
          "border-node-discussion/60",
          props.selected && "!border-node-discussion shadow-[0_0_8px_0px] shadow-node-discussion/40",
          isActive && "[animation:node-running_1.5s_ease-in-out_infinite]",
          isDraggingTool && "!border-node-agent ring-2 ring-node-agent/40 shadow-[0_0_20px_-3px] shadow-node-agent/30"
        )}
      >
        {/* Top handle — data input from upstream */}
        <Handle
          type="target"
          id="top"
          position={Position.Top}
          style={{ left: "50%", transform: "translate(-50%, -50%)" }}
          className={cn(handleBase, handleCyan)}
        />

        <Handle
          type="target"
          id="participants"
          position={Position.Left}
          style={{ top: "50%", transform: "translate(-50%, -50%)" }}
          className={cn(handleBase, handleBlue)}
        />

        {/* Bottom handles — three output modes */}
        <Handle
          type="source"
          id="full"
          position={Position.Bottom}
          style={{ left: 60, transform: "translate(-50%, 50%)" }}
          className={cn(handleBase, handleCyan)}
        >
          <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/60 whitespace-nowrap font-medium">
            Full
          </span>
        </Handle>
        <Handle
          type="source"
          id="last"
          position={Position.Bottom}
          style={{ left: 140, transform: "translate(-50%, 50%)" }}
          className={cn(handleBase, handleCyan)}
        >
          <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/60 whitespace-nowrap font-medium">
            Last
          </span>
        </Handle>
        <Handle
          type="source"
          id="summary"
          position={Position.Bottom}
          style={{ left: 220, transform: "translate(-50%, 50%)" }}
          className={cn(handleBase, handleCyan)}
        >
          <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/60 whitespace-nowrap font-medium">
            Summary
          </span>
        </Handle>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-node-discussion">
            <Users className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <span
              ref={labelRef}
              contentEditable={editing}
              suppressContentEditableWarning
              onDoubleClick={startEditing}
              onBlur={commitRename}
              onKeyDown={editing ? (e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                if (e.key === "Escape") { labelRef.current!.textContent = data.label; setEditing(false); }
                e.stopPropagation();
              } : undefined}
              onClick={editing ? (e) => e.stopPropagation() : undefined}
              className={cn(
                "block truncate text-sm font-semibold cursor-text outline-none",
                editing && "nodrag truncate-none shadow-[0_0_0_1px_oklch(0.68_0.12_70/0.4)] rounded px-0.5 -mx-0.5"
              )}
            >
              {data.label}
            </span>
            <span className="block text-[10px] text-muted-foreground/70 uppercase tracking-wider">
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

        {/* Spacer + Footer: max rounds badge pinned to bottom */}
        <div className="flex-1" />
        <div className="border-t border-border/40 px-3 py-3">
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
