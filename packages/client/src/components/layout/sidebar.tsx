import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  GitBranch,
  Play,
  Settings,
  Cpu,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Workflows", icon: GitBranch, href: "/workflows" },
  { label: "Runs", icon: Play, href: "/runs" },
  { label: "Agents", icon: Cpu, href: "/agents" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function Sidebar() {
  const currentPath = window.location.pathname;

  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
          OC
        </div>
        <span className="text-lg font-semibold tracking-tight">
          OpenConclave
        </span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive =
            currentPath === item.href ||
            (item.href !== "/" && currentPath.startsWith(item.href));
          return (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-success" />
          Server connected
        </div>
      </div>
    </aside>
  );
}
