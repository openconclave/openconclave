import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { User, X, Terminal, Server, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { BaseNode } from "./base-node";
import { useNodeData } from "@/hooks/use-node-data";
import { useConclaveStore } from "@/stores/conclave-store";
import type { AgentConfig, ToolConfig } from "@openconclave/shared";

// Max rows of tool pills shown inside the node. Beyond this, surplus pills
// collapse into a single "+K more" button that opens the inspector.
const MAX_TOOL_ROWS = 3;

const toolTypeIcons: Record<ToolConfig["toolType"], React.ElementType> = {
  builtin: Terminal,
  mcp: Server,
  knowledge: BookOpen,
};

const toolTypeColors: Record<ToolConfig["toolType"], string> = {
  builtin: "bg-node-tool",
  mcp: "bg-node-tool",
  knowledge: "bg-node-knowledge",
};

export function AgentNode(props: NodeProps) {
  const data = useNodeData(props);
  const config = data.config as AgentConfig;
  const engine = config.engine ?? "claude";
  const model = engine === "debug" ? "static"
    : engine === "ollama" ? config.ollamaModel ?? "ollama"
    : engine === "openai" ? config.openaiModel ?? "openai"
    : config.model ?? "sonnet";

  const updateNodeConfig = useConclaveStore((s) => s.updateNodeConfig);
  const setSelectedNode = useConclaveStore((s) => s.setSelectedNode);
  const tools = config.tools ?? [];
  const [dragOver, setDragOver] = useState(false);

  // Row-capped pill rendering: show as many pills as fit in MAX_TOOL_ROWS,
  // then collapse the remainder into "+K more". Measurement-driven so pills
  // of varying widths (long tool names) are respected.
  const toolsContainerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tools.length);

  // Reset to full count whenever the tool list itself changes
  useLayoutEffect(() => {
    setVisibleCount(tools.length);
  }, [tools]);

  // Shrink visibleCount by 1 per render pass until pill rows fit under cap.
  // Converges in O(overflow) renders, stops as soon as rows ≤ MAX_TOOL_ROWS.
  useLayoutEffect(() => {
    const container = toolsContainerRef.current;
    if (!container || visibleCount === 0) return;
    const children = container.children;
    if (children.length === 0) return;
    const tops = new Set<number>();
    for (let i = 0; i < children.length; i++) {
      tops.add((children[i] as HTMLElement).offsetTop);
    }
    if (tops.size > MAX_TOOL_ROWS && visibleCount > 1) {
      setVisibleCount((v) => v - 1);
    }
  }, [visibleCount, tools]);

  const hiddenCount = tools.length - visibleCount;
  const shownTools = tools.slice(0, visibleCount);

  const openInspectorToTools = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedNode(props.id);
    },
    [props.id, setSelectedNode]
  );

  const addTool = useCallback(
    (tool: ToolConfig) => {
      const existing = config.tools ?? [];
      // Prevent duplicates
      if (existing.some((t) => t.toolType === tool.toolType && t.toolId === tool.toolId)) return;
      updateNodeConfig(props.id, { tools: [...existing, tool] });
    },
    [config.tools, props.id, updateNodeConfig]
  );

  const removeTool = useCallback(
    (index: number) => {
      const existing = config.tools ?? [];
      updateNodeConfig(props.id, { tools: existing.filter((_, i) => i !== index) });
    },
    [config.tools, props.id, updateNodeConfig]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/openconclave-tool")) {
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
      const raw = e.dataTransfer.getData("application/openconclave-tool");
      if (!raw) return;
      const tool = JSON.parse(raw) as ToolConfig;
      addTool(tool);
    },
    [addTool]
  );

  return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <BaseNode
        {...props}
        data={data}
        icon={User}
        subtitle={`${engine} · ${model}`}
      >
        {config.systemPrompt && (
          <p className="truncate text-[10px]">{config.systemPrompt}</p>
        )}
        {/* Tool chips — measured to fit MAX_TOOL_ROWS, surplus collapses to +K */}
        {tools.length > 0 && (
          <div ref={toolsContainerRef} className="flex flex-wrap gap-1 mt-1">
            {shownTools.map((tool, i) => {
              const Icon = toolTypeIcons[tool.toolType];
              return (
                <span
                  key={`${tool.toolType}-${tool.toolId}`}
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full pl-1 pr-0.5 py-0.5 text-[9px] font-medium text-white",
                    toolTypeColors[tool.toolType]
                  )}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {tool.toolName}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTool(i);
                    }}
                    className="ml-0.5 rounded-full hover:bg-white/20 p-0.5"
                  >
                    <X className="h-2 w-2" />
                  </button>
                </span>
              );
            })}
            {hiddenCount > 0 && (
              <button
                onClick={openInspectorToTools}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-medium text-muted-foreground bg-muted hover:bg-muted/80 transition-colors nodrag"
                title={`${hiddenCount} more tool${hiddenCount === 1 ? "" : "s"} — click to view all`}
              >
                +{hiddenCount} more
              </button>
            )}
          </div>
        )}
        {/* Drop zone indicator */}
        {dragOver && (
          <div className="mt-1 rounded border border-dashed border-primary/50 bg-primary/10 px-2 py-1 text-[9px] text-primary text-center">
            Drop tool here
          </div>
        )}
      </BaseNode>
    </div>
  );
}
