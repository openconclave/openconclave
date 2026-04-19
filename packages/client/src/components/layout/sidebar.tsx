import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { VERSION } from "@openconclave/shared";
import {
  LayoutDashboard,
  GitBranch,
  Play,
  Settings,
  Brain,
  Plus,
  ArrowUpCircle,
} from "lucide-react";

interface UpdateStatus {
  latest: string | null;
  hasUpdate: boolean;
}

function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    api.get<UpdateStatus>("/update/status").then(setStatus).catch(() => {});
  }, []);
  return status;
}

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Conclaves", icon: GitBranch, href: "/conclaves", quickAction: { href: "/conclaves/new", title: "New conclave" } },
  { label: "Runs", icon: Play, href: "/runs" },
  { label: "Knowledge", icon: Brain, href: "/settings/knowledge" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const currentPath = window.location.pathname;
  const update = useUpdateStatus();

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-card transition-all duration-200 ease-in-out",
        open ? "w-60" : "w-14"
      )}
    >
      <div className="flex h-14 items-center border-b border-border px-3 shrink-0">
        {open ? (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                OC
              </div>
              <span className="text-lg font-semibold tracking-tight whitespace-nowrap">
                OpenConclave
              </span>
            </div>
            <button
              onClick={onToggle}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              title="Collapse sidebar"
            >
              <SidebarToggleIcon className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={onToggle}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors mx-auto"
            title="Expand sidebar"
          >
            <SidebarToggleIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive =
            currentPath === item.href ||
            (item.href !== "/" && currentPath.startsWith(item.href));
          return (
            <div key={item.href} className="group relative">
              <a
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
              {open && item.quickAction && (
                <a
                  href={item.quickAction.href}
                  title={item.quickAction.title}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground hover:bg-accent/50 transition-all"
                >
                  <Plus className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-2 space-y-1">
        {open ? (
          <>
            <div className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-success shrink-0" />
              Server connected
            </div>
            {update?.hasUpdate && update.latest ? (
              <a
                href="/settings"
                title={`v${update.latest} is available`}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
              >
                <ArrowUpCircle className="h-3 w-3" />
                v{update.latest} available →
              </a>
            ) : (
              <div className="px-2.5 py-1 text-[10px] text-muted-foreground/50">
                Version {VERSION}
              </div>
            )}
          </>
        ) : (
          update?.hasUpdate && (
            <a
              href="/settings"
              title={`v${update.latest} is available`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary hover:bg-accent/50 mx-auto"
            >
              <ArrowUpCircle className="h-4 w-4" />
            </a>
          )
        )}
      </div>
    </aside>
  );
}
