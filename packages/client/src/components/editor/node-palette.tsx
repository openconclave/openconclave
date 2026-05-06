import { useState, useEffect, useRef, useCallback } from "react";
import {
  Zap, User, GitFork, Code, Combine, MessageCircleQuestion, Send, FileText, BookOpen,
  Terminal, FileEdit, FileSearch, FolderSearch, Search, Server, ChevronDown, ChevronRight,
  Users, Loader2, Boxes, Globe, Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeType, KnowledgeBase, McpRegistrySearchResponse, McpRegistryServer, McpServerLaunchConfig } from "@openconclave/shared";
import { API_PORT } from "@openconclave/shared";
import { useConclaveStore } from "@/stores/conclave-store";

// ── Node palette items ────────────────────────────────────────

interface PaletteNode {
  type: NodeType;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}

interface PaletteGroup {
  label: string;
  nodes: PaletteNode[];
}

const paletteGroups: PaletteGroup[] = [
  {
    label: "Flow",
    nodes: [
      { type: "trigger", label: "Trigger", icon: Zap, color: "bg-node-trigger", description: "Start a conclave" },
      { type: "prompt", label: "Channel Loop", icon: MessageCircleQuestion, color: "bg-node-trigger", description: "Pause and ask" },
      { type: "output", label: "Output", icon: Send, color: "bg-node-trigger", description: "Send result" },
    ],
  },
  {
    label: "AI",
    nodes: [
      { type: "agent", label: "Agent", icon: User, color: "bg-node-agent", description: "AI agent task" },
      { type: "discussion", label: "Discussion", icon: Users, color: "bg-node-discussion", description: "Multi-agent round table" },
    ],
  },
  {
    label: "Logic",
    nodes: [
      { type: "condition", label: "Condition", icon: GitFork, color: "bg-node-condition", description: "Branch logic" },
      { type: "merge", label: "Merge", icon: Combine, color: "bg-node-condition", description: "Combine all inputs" },
      { type: "code", label: "Code", icon: Code, color: "bg-node-transform", description: "Run Python/Node/Bash" },
      { type: "file", label: "File", icon: FileText, color: "bg-node-condition", description: "Read file as input" },
    ],
  },
];

function getDefaultConfig(type: NodeType) {
  switch (type) {
    case "trigger": return { type: "manual" };
    case "agent": return { model: "sonnet" };
    case "condition": return { expression: "" };
    case "code": return { runtime: "python", code: "" };
    case "merge": return {};
    case "prompt": return { description: "Ask a question if needed" };
    case "output": return { type: "log", config: {} };
    case "file": return { path: "" };
    case "discussion":
      return {
        prompt: "Topic: {{input}}\n\n{{transcript}}\n\nYou are {{agentName}}. Share your perspective.",
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
  mcpLaunchConfig?: McpServerLaunchConfig;
}

const codeToolItems: ToolItem[] = [
  { toolType: "builtin", toolId: "Bash", toolName: "Bash", icon: Terminal, description: "Run shell commands" },
  { toolType: "builtin", toolId: "Edit", toolName: "Edit", icon: FileEdit, description: "Edit files" },
  { toolType: "builtin", toolId: "Read", toolName: "Read", icon: FileSearch, description: "Read files" },
  { toolType: "builtin", toolId: "Write", toolName: "Write", icon: FileEdit, description: "Write files" },
  { toolType: "builtin", toolId: "Glob", toolName: "Glob", icon: FolderSearch, description: "Find files by pattern" },
  { toolType: "builtin", toolId: "Grep", toolName: "Grep", icon: Search, description: "Search file contents" },
  { toolType: "builtin", toolId: "WebFetch", toolName: "Web Fetch", icon: Globe, description: "Fetch a URL via headless browser" },
  { toolType: "builtin", toolId: "WebSearch", toolName: "Web Search", icon: Globe, description: "Search the web (configure in Settings → Web search)" },
  { toolType: "builtin", toolId: "ViewImage", toolName: "View Image", icon: ImageIcon, description: "Load PNG/JPEG so a vision-capable Ollama model can see it" },
];

const builtinMcpItems: ToolItem[] = [
  {
    toolType: "mcp",
    toolId: "openconclave",
    toolName: "OC Tools",
    icon: Boxes,
    description: "Manage conclaves & runs",
    mcpLaunchConfig: { registryName: "openconclave", remote: { type: "streamable-http", url: `http://localhost:${API_PORT}/mcp` } },
  },
];

// ── MCP Registry search ──────────────────────────────────────

function McpRegistrySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<McpRegistryServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/mcp-registry/search?q=${encodeURIComponent(q)}&limit=10`);
        if (res.ok) {
          const data = (await res.json()) as McpRegistrySearchResponse;
          setResults(data.servers);
        }
      } catch { /* ignore */ }
      setLoading(false);
      setHasSearched(true);
    }, 300);
  }, []);

  useEffect(() => {
    doSearch(query);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const toToolItem = (server: McpRegistryServer): ToolItem & { mcpLaunchConfig: McpRegistryServer["launchConfig"] } => ({
    toolType: "mcp",
    toolId: server.name,
    toolName: server.title,
    icon: Server,
    description: server.description.slice(0, 60),
    mcpLaunchConfig: server.launchConfig,
  });

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search MCP Registry..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-border bg-background pl-6 pr-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {loading && <Loader2 className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground animate-spin" />}
      </div>
      {results.map((server) => {
        const item = toToolItem(server);
        return (
          <div
            key={server.name}
            draggable
            onDragStart={(e) => {
              const data = JSON.stringify({
                toolType: item.toolType,
                toolId: item.toolId,
                toolName: item.toolName,
                mcpLaunchConfig: item.mcpLaunchConfig,
              });
              e.dataTransfer.setData("application/openconclave-tool", data);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-2 py-1.5 cursor-grab active:cursor-grabbing hover:bg-secondary transition-colors"
          >
            {server.iconUrl ? (
              <img src={server.iconUrl} alt="" className="h-5 w-5 rounded shrink-0 object-contain" />
            ) : (
              <div className="flex h-5 w-5 items-center justify-center rounded shrink-0 bg-node-tool">
                <Server className="h-3 w-3 text-white" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{server.title}</p>
              <p className="text-[9px] text-muted-foreground truncate">{server.description}</p>
              <div className="flex gap-1 mt-0.5">
                {server.launchConfig.package && (
                  <span className="text-[8px] px-1 py-0 rounded bg-blue-500/20 text-blue-400">stdio</span>
                )}
                {server.launchConfig.remote && (
                  <span className="text-[8px] px-1 py-0 rounded bg-green-500/20 text-green-400">{server.launchConfig.remote.type}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {hasSearched && results.length === 0 && !loading && (
        <p className="text-[9px] text-muted-foreground px-1">No servers found.</p>
      )}
      {!hasSearched && !loading && (
        <p className="text-[9px] text-muted-foreground px-1">
          Search the{" "}
          <a href="https://registry.modelcontextprotocol.io" target="_blank" rel="noopener" className="underline text-primary hover:text-primary/80">
            MCP Registry
          </a>
        </p>
      )}
    </div>
  );
}

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

  // Custom pointer-based drag for node palette items. Replaces HTML5 DnD so
  // we keep full cursor control (grabbing throughout, no browser arrow).
  const setPendingNodeDrop = useConclaveStore((s) => s.setPendingNodeDrop);
  const setPendingModeratorDrop = useConclaveStore((s) => s.setPendingModeratorDrop);
  const dragDataRef = useRef<{ type: NodeType; label: string; config: unknown } | null>(null);

  const onNodePointerDown = useCallback((e: React.PointerEvent, type: NodeType, label: string) => {
    if (e.button !== 0) return;
    e.preventDefault();

    dragDataRef.current = { type, label, config: getDefaultConfig(type) };
    document.body.classList.add("oc-dragging-node");

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("oc-dragging-node");

      if (!dragDataRef.current) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);

      // 1) Moderator slot takes priority — only agent/code types are valid.
      const modSlot = target?.closest("[data-moderator-slot]") as HTMLElement | null;
      const discussionNodeId = modSlot?.dataset.discussionNodeId;
      const dropType = dragDataRef.current.type;
      if (modSlot && discussionNodeId && (dropType === "agent" || dropType === "code")) {
        setPendingModeratorDrop({
          discussionNodeId,
          ...dragDataRef.current,
        });
        dragDataRef.current = null;
        return;
      }

      // 2) Canvas drop — create a new node.
      const isCanvas = target?.closest(".react-flow");
      if (isCanvas) {
        setPendingNodeDrop({
          ...dragDataRef.current,
          screenX: ev.clientX,
          screenY: ev.clientY,
        });
      }
      dragDataRef.current = null;
    };

    window.addEventListener("pointerup", onUp);
  }, [setPendingNodeDrop, setPendingModeratorDrop]);

  const setDraggingTool = useConclaveStore((s) => s.setDraggingTool);

  const onToolDragStart = (e: React.DragEvent, item: ToolItem) => {
    setDraggingTool(true);
    const data = JSON.stringify({
      toolType: item.toolType,
      toolId: item.toolId,
      toolName: item.toolName,
      ...(item.mcpLaunchConfig && { mcpLaunchConfig: item.mcpLaunchConfig }),
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
    <div className="flex border-r border-border bg-card">
      {/* Column 1: Nodes */}
      <div className="w-48 p-3 space-y-2 overflow-y-auto border-r border-border/40">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3">
          Nodes
        </h3>
        {paletteGroups.map((group) => (
          <div key={group.label} className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1">
              {group.label}
            </p>
            {group.nodes.map((nt) => (
              <div
                key={nt.type}
                onPointerDown={(e) => onNodePointerDown(e, nt.type, nt.label)}
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-2 py-2 cursor-grab active:cursor-grabbing hover:bg-secondary transition-colors select-none"
              >
                <div className={cn("flex h-6 w-6 items-center justify-center shrink-0 rounded-md", nt.color)}>
                  <nt.icon className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{nt.label}</p>
                  <p className="text-[9px] text-muted-foreground truncate">{nt.description}</p>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Column 2: Tools */}
      <div className="w-48 p-3 space-y-2 overflow-y-auto">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
          Tools
        </h3>
        <p className="text-[9px] text-muted-foreground px-1 mb-2 leading-snug">
          Drag and drop onto an Agent node.
        </p>

        <div className="space-y-3">
          <ToolGroup label="Code">
            {codeToolItems.map((item) => (
              <DraggableToolItem key={item.toolId} item={item} onDragStart={onToolDragStart} />
            ))}
          </ToolGroup>

          <ToolGroup label="Built-in MCP">
            {builtinMcpItems.map((item) => (
              <DraggableToolItem key={item.toolId} item={item} onDragStart={onToolDragStart} />
            ))}
          </ToolGroup>

          <ToolGroup label="External MCP">
            <McpRegistrySearch />
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
    </div>
  );
}
