import { cn } from "@/lib/utils";
import {
  Terminal,
  FileEdit,
  FileSearch,
  FolderSearch,
  Search,
  Globe,
  GripVertical,
} from "lucide-react";

// Built-in Claude Code tools
const builtinTools = [
  { id: "Bash", label: "Bash", icon: Terminal, description: "Run shell commands" },
  { id: "Edit", label: "Edit", icon: FileEdit, description: "Edit files" },
  { id: "Read", label: "Read", icon: FileSearch, description: "Read files" },
  { id: "Write", label: "Write", icon: FileEdit, description: "Write files" },
  { id: "Glob", label: "Glob", icon: FolderSearch, description: "Find files by pattern" },
  { id: "Grep", label: "Grep", icon: Search, description: "Search file contents" },
  { id: "WebFetch", label: "WebFetch", icon: Globe, description: "Fetch web content" },
  { id: "WebSearch", label: "WebSearch", icon: Globe, description: "Search the web" },
];

// Known MCP servers (user can add custom ones too)
const knownMcpServers = [
  {
    id: "playwright",
    label: "Playwright",
    description: "Browser automation",
    config: { command: "npx", args: ["@anthropic-ai/mcp-server-playwright@latest"] },
  },
  {
    id: "telegram-voice",
    label: "Telegram",
    description: "Send/receive Telegram messages",
    config: { command: "npx", args: ["@anthropic-ai/mcp-server-telegram-voice@latest"] },
  },
  {
    id: "filesystem",
    label: "Filesystem",
    description: "File system access",
    config: { command: "npx", args: ["@anthropic-ai/mcp-server-filesystem@latest"] },
  },
  {
    id: "fetch",
    label: "Fetch",
    description: "HTTP requests",
    config: { command: "npx", args: ["@anthropic-ai/mcp-server-fetch@latest"] },
  },
];

export function ToolPicker({
  selectedTools,
  selectedMcpServers,
  onToolsChange,
  onMcpServersChange,
}: {
  selectedTools: string[];
  selectedMcpServers: string[];
  onToolsChange: (tools: string[]) => void;
  onMcpServersChange: (servers: string[]) => void;
}) {
  const toggleTool = (id: string) => {
    if (selectedTools.includes(id)) {
      onToolsChange(selectedTools.filter((t) => t !== id));
    } else {
      onToolsChange([...selectedTools, id]);
    }
  };

  const toggleMcp = (id: string) => {
    if (selectedMcpServers.includes(id)) {
      onMcpServersChange(selectedMcpServers.filter((s) => s !== id));
    } else {
      onMcpServersChange([...selectedMcpServers, id]);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Built-in Tools
        </p>
        <div className="space-y-1">
          {builtinTools.map((tool) => (
            <label
              key={tool.id}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
                selectedTools.includes(tool.id)
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              <input
                type="checkbox"
                checked={selectedTools.includes(tool.id)}
                onChange={() => toggleTool(tool.id)}
                className="rounded border-border"
              />
              <tool.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{tool.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
          MCP Servers
        </p>
        <div className="space-y-1">
          {knownMcpServers.map((mcp) => (
            <label
              key={mcp.id}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
                selectedMcpServers.includes(mcp.id)
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              <input
                type="checkbox"
                checked={selectedMcpServers.includes(mcp.id)}
                onChange={() => toggleMcp(mcp.id)}
                className="rounded border-border"
              />
              <GripVertical className="h-3.5 w-3.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <span>{mcp.label}</span>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {mcp.description}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// Export for runtime to look up MCP configs
export { knownMcpServers };
