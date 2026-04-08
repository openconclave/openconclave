import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "@openconclave/shared";
import { useWorkflowStore } from "@/stores/workflow-store";

const GRID = 20;
const nodeRounding = "rounded-2xl";

const nodeBorderColors: Record<string, string> = {
  trigger: "border-node-trigger/60",
  output: "border-node-trigger/60",
  agent: "border-node-agent/60",
  discussion: "border-node-discussion/60",
  condition: "border-node-condition/60",
  code: "border-node-transform/60",
  merge: "border-node-condition/60",
  prompt: "border-node-trigger/60",
  file: "border-node-condition/60",
};

const nodeSelectedStyles: Record<string, string> = {
  trigger: "!border-node-trigger shadow-[0_0_8px_0px] shadow-node-trigger/40",
  output: "!border-node-trigger shadow-[0_0_8px_0px] shadow-node-trigger/40",
  agent: "!border-node-agent shadow-[0_0_8px_0px] shadow-node-agent/40",
  discussion: "!border-node-discussion shadow-[0_0_8px_0px] shadow-node-discussion/40",
  condition: "!border-node-condition shadow-[0_0_8px_0px] shadow-node-condition/40",
  code: "!border-node-transform shadow-[0_0_8px_0px] shadow-node-transform/40",
  merge: "!border-node-condition shadow-[0_0_8px_0px] shadow-node-condition/40",
  prompt: "!border-node-trigger shadow-[0_0_8px_0px] shadow-node-trigger/40",
  file: "!border-node-condition shadow-[0_0_8px_0px] shadow-node-condition/40",
};

const nodeAccentColors: Record<string, string> = {
  trigger: "bg-node-trigger",
  output: "bg-node-trigger",
  agent: "bg-node-agent",
  discussion: "bg-node-discussion",
  condition: "bg-node-condition",
  code: "bg-node-transform",
  merge: "bg-node-condition",
  prompt: "bg-node-trigger",
  file: "bg-node-condition",
};

const handleColors = [
  "!border-[oklch(0.65_0.18_200)] hover:!bg-[oklch(0.65_0.18_200/0.3)]",
  "!border-[oklch(0.65_0.18_260)] hover:!bg-[oklch(0.65_0.18_260/0.3)]",
  "!border-[oklch(0.65_0.15_320)] hover:!bg-[oklch(0.65_0.15_320/0.3)]",
];

const handleBase = "!h-3 !w-3 !rounded-full !border-2 !bg-card transition-colors";

export function BaseNode({
  id,
  data,
  selected,
  icon: Icon,
  children,
  subtitle,
  subtitleOptions,
  onSubtitleChange,
  showTargetHandle = true,
  showSourceHandle = true,
  sourceHandles,
}: NodeProps & {
  data: WorkflowNodeData;
  icon: React.ElementType;
  children?: React.ReactNode;
  subtitle?: string;
  subtitleOptions?: { value: string; label: string }[];
  onSubtitleChange?: (value: string) => void;
  showTargetHandle?: boolean;
  showSourceHandle?: boolean;
  sourceHandles?: { id: string; label: string; position: number }[];
}) {
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const activeNodeIds = useWorkflowStore((s) => s.activeNodeIds);
  const skippedNodeIds = useWorkflowStore((s) => s.skippedNodeIds);
  const isDraggingTool = useWorkflowStore((s) => s.isDraggingTool);
  const [editing, setEditing] = useState(false);
  const openDropdownId = useWorkflowStore((s) => s.openDropdownId);
  const setOpenDropdown = useWorkflowStore((s) => s.setOpenDropdown);
  const dropdownOpen = openDropdownId === id;
  const labelRef = useRef<HTMLSpanElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  }, []);

  const commitRename = useCallback(() => {
    const el = labelRef.current;
    if (!el) return;
    const trimmed = (el.textContent ?? "").trim();
    if (trimmed && trimmed !== data.label) {
      updateNodeData(id, { label: trimmed });
    } else {
      el.textContent = data.label;
    }
    setEditing(false);
  }, [data.label, id, updateNodeData]);

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
  const isActive = activeNodeIds.has(id);
  const isSkipped = skippedNodeIds.has(id);
  const isAgent = data.type === "agent" || data.type === "discussion";
  const toolHighlight = isDraggingTool && isAgent;
  const toolDim = isDraggingTool && !isAgent;

  // Snap node height to nearest multiple of 2×GRID (40px)
  // so that left/right handles at 50% always land on a grid dot
  const nodeRef = useRef<HTMLDivElement>(null);
  const SNAP = GRID * 2;
  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    el.style.height = "";
    const h = el.offsetHeight;
    el.style.height = `${Math.ceil(h / SNAP) * SNAP}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.label, data.type]);

  return (
    <div
      ref={nodeRef}
      className={cn(
        "w-[240px] border-[1.5px] bg-gradient-to-b from-card to-card/80 transition-all duration-200 cursor-pointer",
        nodeRounding,
        nodeBorderColors[data.type],
        selected && (nodeSelectedStyles[data.type] ?? "!border-primary ring-1 ring-primary/30"),
        isActive && "[animation:node-running_1.5s_ease-in-out_infinite]",
        isSkipped && "opacity-40 !border-muted-foreground grayscale-[0.5]",
        toolHighlight && "!border-node-agent ring-2 ring-node-agent/40 shadow-[0_0_20px_-3px] shadow-node-agent/30",
        toolDim && "opacity-30"
      )}
    >
      {showTargetHandle && (
        <Handle type="target" id="top" position={Position.Top} style={{ left: "50%", transform: "translate(-50%, -50%)" }} className={cn(handleBase, handleColors[0])} />
      )}

      <Handle type="source" id="left" position={Position.Left} style={{ top: "50%", transform: "translate(-50%, -50%)" }} className={cn(handleBase, handleColors[1])} />

      <Handle type="source" id="right" position={Position.Right} style={{ top: "50%", transform: "translate(50%, -50%)" }} className={cn(handleBase, handleColors[2])} />

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center shrink-0 rounded-md",
            nodeAccentColors[data.type]
          )}
        >
          <Icon className="h-4 w-4 text-white" />
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
              "text-sm font-semibold truncate block cursor-text outline-none",
              editing && "nodrag truncate-none shadow-[0_0_0_1px_oklch(0.68_0.12_70/0.4)] rounded px-0.5 -mx-0.5"
            )}
          >
            {data.label}
          </span>
          {subtitle && subtitleOptions && onSubtitleChange ? (
            <div className="relative nodrag" ref={dropdownRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setOpenDropdown(dropdownOpen ? null : id); }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground/70 uppercase tracking-wider hover:text-muted-foreground transition-colors"
              >
                {subtitle}
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-50"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {dropdownOpen && dropdownRef.current && createPortal(
                <>
                  <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); setOpenDropdown(null); }} />
                  <div
                    className="fixed min-w-[140px] rounded-lg border border-border bg-card shadow-2xl py-1"
                    style={{
                      zIndex: 9999,
                      left: dropdownRef.current.getBoundingClientRect().left,
                      top: dropdownRef.current.getBoundingClientRect().bottom + 4,
                    }}
                  >
                    {subtitleOptions.map((o) => {
                      const active = o.label.toLowerCase() === subtitle.toLowerCase();
                      return (
                        <button
                          key={o.value}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSubtitleChange(o.value);
                            setOpenDropdown(null);
                          }}
                          className={cn(
                            "flex w-full items-center px-3 py-1.5 text-xs transition-colors",
                            active
                              ? "bg-primary/15 text-primary"
                              : "text-muted-foreground hover:bg-accent"
                          )}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </>,
                document.body
              )}
            </div>
          ) : subtitle ? (
            <span className="block text-[10px] text-muted-foreground/70 uppercase tracking-wider">{subtitle}</span>
          ) : null}
        </div>
      </div>

      {/* Divider + Content */}
      <div className="border-t border-border/40 flex-1">
        {children && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {children}
          </div>
        )}
      </div>

      {/* Bottom handle */}
      {showSourceHandle && !sourceHandles && (
        <Handle type="source" id="bottom" position={Position.Bottom} style={{ left: "50%", transform: "translate(-50%, 50%)" }} className={cn(handleBase, handleColors[0])} />
      )}

      {sourceHandles?.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={Position.Bottom}
          className={cn(handleBase, handleColors[0])}
          style={{ left: `${h.position}%`, transform: "translate(-50%, 50%)" }}
        >
          <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/60 whitespace-nowrap font-medium">
            {h.label}
          </span>
        </Handle>
      ))}
    </div>
  );
}
