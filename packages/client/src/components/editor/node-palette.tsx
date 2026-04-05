import { useState, useEffect } from "react";
import {
  Zap, Cpu, GitFork, Code, Combine, MessageCircleQuestion, Send, FileText, BookOpen,
  Terminal, FileEdit, FileSearch, FolderSearch, Search, Globe, Server, ChevronDown, ChevronRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeType, KnowledgeBase } from "@openconclave/shared";

// ── Node palette items ────────────────────────────────────────

const paletteNodes: {
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
  { type: "merge", label: "Merge", icon: Combine, color: "bg-info", description: "Combine all inputs" },
  { type: "prompt", label: "Channel Loop", icon: MessageCircleQuestion, color: "bg-warning", description: "Ask via channel" },
  { type: "output", label: "Output", icon: Send, color: "bg-node-output", description: "Send result" },
  { type: "file", label: "File", icon: FileText, color: "bg-info", description: "Read file as input" },
  { type: "discussion", label: "Discussion", icon: Users, color: "bg-node-discussion", description: "Multi-agent round table" },
];

function getDefaultConfig(type: NodeType) {
  switch (type) {
    case "trigger": return { type: "manual" };
    case "agent": return { model: "sonnet" };
    case "condition": return { expression: "" };
    case "transform": return { runtime: "python", code: "" };
    case "merge": return {};
    case "prompt": return { description: "Ask a question if needed" };
    case "output": return { type: "log", config: {} };
    case "file": return { path: "" };
    case "discussion":
      return {
        prompt: "{{transcript}}\n\nYou are {{agentName}}. Share your perspective.",
        maxRounds: 3,
      };
  }
}

// ── Tool palette items ────────────────────────────────────────

interface ToolItem {
  toolType: "builtin" | "mcp" | "knowledge";
  toolId: string;
  toolName: string;
  icon: React.ElementType;
  description: string;
}

const builtinToolItems: ToolItem[] = [
  { toolType: "builtin", toolId: "Bash", toolName: "Bash", icon: Terminal, description: "Run shell commands" },
  { toolType: "builtin", toolId: "Edit", toolName: "Edit", icon: FileEdit, description: "Edit files" },
  { toolType: "builtin", toolId: "Read", toolName: "Read", icon: FileSearch, description: "Read files" },
  { toolType: "builtin", toolId: "Write", toolName: "Write", icon: FileEdit, description: "Write files" },
  { toolType: "builtin", toolId: "Glob", toolName: "Glob", icon: FolderSearch, description: "Find files by pattern" },
  { toolType: "builtin", toolId: "Grep", toolName: "Grep", icon: Search, description: "Search file contents" },
  { toolType: "builtin", toolId: "WebFetch", toolName: "WebFetch", icon: Globe, description: "Fetch web content" },
  { toolType: "builtin", toolId: "WebSearch", toolName: "WebSearch", icon: Globe, description: "Search the web" },
];

const mcpToolItems: ToolItem[] = [
  { toolType: "mcp", toolId: "playwright", toolName: "Playwright", icon: Server, description: "Browser automation" },
  { toolType: "mcp", toolId: "telegram-voice", toolName: "Telegram", icon: Server, description: "Send/receive Telegram" },
  { toolType: "mcp", toolId: "filesystem", toolName: "Filesystem", icon: Server, description: "File system access" },
  { toolType: "mcp", toolId: "fetch", toolName: "Fetch", icon: Server, description: "HTTP requests" },
];

// ── Collapsible group ─────────────────────────────────────────

interface ToolGroupProps {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function ToolGroup({ label, defaultOpen = true, children }: ToolGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = open ? ChevronDown : ChevronRight;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-1 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </button>
      {open && <div className="space-y-1 pl-1">{children}</div>}
    </div>
  );
}

// ── Draggable tool item ───────────────────────────────────────

interface DraggableToolItemProps {
  item: ToolItem;
  onDragStart: (e: React.DragEvent, item: ToolItem) => void;
}

function DraggableToolItem({ item, onDragStart }: DraggableToolItemProps) {
  const accentColor = item.toolType === "knowledge" ? "bg-node-knowledge" : "bg-node-tool";

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-2 py-1.5 cursor-grab active:cursor-grabbing hover:bg-secondary transition-colors"
    >
      <div className={cn("flex h-5 w-5 items-center justify-center rounded shrink-0", accentColor)}>
        <item.icon className="h-3 w-3 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{item.toolName}</p>
        <p className="text-[9px] text-muted-foreground truncate">{item.description}</p>
      </div>
    </div>
  );
}

// ── Main palette ──────────────────────────────────────────────

export function NodePalette() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d: { data: KnowledgeBase[] }) => setKnowledgeBases(d.data ?? []))
      .catch(() => setKnowledgeBases([]));
  }, []);

  const onNodeDragStart = (e: React.DragEvent, type: NodeType, label: string) => {
    const data = JSON.stringify({ type, label, config: getDefaultConfig(type) });
    e.dataTransfer.setData("application/openconclave-node", data);
    e.dataTransfer.effectAllowed = "move";
  };

  const onToolDragStart = (e: React.DragEvent, item: ToolItem) => {
    const data = JSON.stringify({
      toolType: item.toolType,
      toolId: item.toolId,
      toolName: item.toolName,
    });
    e.dataTransfer.setData("application/openconclave-tool", data);
    e.dataTransfer.effectAllowed = "copy";
  };

  const knowledgeToolItems: ToolItem[] = knowledgeBases.map((kb) => ({
    toolType: "knowledge" as const,
    toolId: String(kb.id),
    toolName: kb.name,
    icon: BookOpen,
    description: `${kb.documentCount} docs`,
  }));

  return (
    <div className="w-52 border-r border-border bg-card p-3 space-y-2 overflow-y-auto">
      {/* Nodes section */}
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3">
        Nodes
      </h3>
      {paletteNodes.map((nt) => (
        <div
          key={nt.type}
          draggable
          onDragStart={(e) => onNodeDragStart(e, nt.type, nt.label)}
          className="flex items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5 cursor-grab active:cursor-grabbing hover:bg-secondary transition-colors"
        >
          <div className={cn("flex h-7 w-7 items-center justify-center rounded", nt.color)}>
            <nt.icon className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">{nt.label}</p>
            <p className="text-[10px] text-muted-foreground">{nt.description}</p>
          </div>
        </div>
      ))}

      {/* Divider */}
      <div className="border-t border-border/60 my-3" />

      {/* Tools section */}
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
        Tools
      </h3>
      <p className="text-[9px] text-muted-foreground px-1 mb-2 leading-snug">
        Drag and drop onto an Agent node.
      </p>

      <div className="space-y-3">
        <ToolGroup label="Built-in Tools">
          {builtinToolItems.map((item) => (
            <DraggableToolItem key={item.toolId} item={item} onDragStart={onToolDragStart} />
          ))}
        </ToolGroup>

        <ToolGroup label="MCP Servers">
          {mcpToolItems.map((item) => (
            <DraggableToolItem key={item.toolId} item={item} onDragStart={onToolDragStart} />
          ))}
        </ToolGroup>

        <ToolGroup label="Knowledge Bases" defaultOpen={knowledgeToolItems.length > 0}>
          {knowledgeToolItems.length === 0 ? (
            <p className="text-[9px] text-muted-foreground px-1 py-0.5">
              No knowledge bases.{" "}
              <a href="/knowledge" className="underline text-primary hover:text-primary/80">
                Create one
              </a>
            </p>
          ) : (
            knowledgeToolItems.map((item) => (
              <DraggableToolItem key={item.toolId} item={item} onDragStart={onToolDragStart} />
            ))
          )}
        </ToolGroup>
      </div>
    </div>
  );
}
