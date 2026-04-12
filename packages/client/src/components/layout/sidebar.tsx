import { cn } from "@/lib/utils";
import { VERSION } from "@openconclave/shared";
import {
  LayoutDashboard,
  GitBranch,
  Play,
  Settings,
  Brain,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Conclaves", icon: GitBranch, href: "/conclaves" },
  { label: "Runs", icon: Play, href: "/runs" },
  { label: "Knowledge", icon: Brain, href: "/knowledge" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const currentPath = window.location.pathname;

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-card transition-all duration-200 ease-in-out overflow-hidden",
        open ? "w-60" : "w-14"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            OC
          </div>
          {open && (
            <span className="text-lg font-semibold tracking-tight whitespace-nowrap">
              OpenConclave
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          title={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          {open ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive =
            currentPath === item.href ||
            (item.href !== "/" && currentPath.startsWith(item.href));
          return (
            <a
              key={item.href}
              href={item.href}
              title={open ? undefined : item.label}
              className={cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                !open && "justify-center"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {open && item.label}
            </a>
          );
        })}
      </nav>

      <div className="border-t border-border p-2 space-y-1">
        {open && (
          <>
            <div className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-success shrink-0" />
              Server connected
            </div>
            <div className="px-2.5 py-1 text-[10px] text-muted-foreground/50">
              Version {VERSION}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
