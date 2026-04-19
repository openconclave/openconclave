import type { ReactElement, SVGProps } from "react";
import { VERSION } from "@openconclave/shared";

export type SectionId =
  | "workspace"
  | "members"
  | "billing"
  | "models"
  | "defaults"
  | "knowledge"
  | "integrations"
  | "web-search"
  | "mcp"
  | "secrets"
  | "appearance"
  | "keybindings"
  | "advanced";

type Icon = (p: SVGProps<SVGSVGElement>) => ReactElement;

interface NavItem {
  id: SectionId;
  label: string;
  icon: Icon;
  enabled: boolean;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const I = {
  Workspace: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" />
    </svg>
  ),
  Users: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Zap: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Brain: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="8" cy="7" r="4" /><circle cx="16" cy="7" r="4" /><path d="M12 11v10" /><path d="M8 21h8" />
    </svg>
  ),
  Sliders: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  Book: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4h11a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" /><path d="M4 4v14" />
    </svg>
  ),
  Plug: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 2v6M6 8v2a6 6 0 0 0 12 0V8M6 8h12M10 22v-6M14 22v-6" />
    </svg>
  ),
  Search: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Tool: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  Lock: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Sun: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  Keyboard: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 17h10" />
    </svg>
  ),
  Gear: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

export const SECTIONS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { id: "workspace", label: "Workspace", icon: I.Workspace, enabled: false },
      { id: "members", label: "Members", icon: I.Users, enabled: false },
      { id: "billing", label: "Usage & billing", icon: I.Zap, enabled: false },
    ],
  },
  {
    label: "AI",
    items: [
      { id: "models", label: "Models & providers", icon: I.Brain, enabled: true },
      { id: "defaults", label: "Defaults", icon: I.Sliders, enabled: false },
      { id: "knowledge", label: "Knowledge", icon: I.Book, enabled: true },
    ],
  },
  {
    label: "Connect",
    items: [
      { id: "integrations", label: "Integrations", icon: I.Plug, enabled: true },
      { id: "web-search", label: "Web search", icon: I.Search, enabled: true },
      { id: "mcp", label: "MCP servers", icon: I.Tool, enabled: true },
      { id: "secrets", label: "Secrets vault", icon: I.Lock, enabled: true },
    ],
  },
  {
    label: "System",
    items: [
      { id: "appearance", label: "Appearance", icon: I.Sun, enabled: false },
      { id: "keybindings", label: "Keybindings", icon: I.Keyboard, enabled: false },
      { id: "advanced", label: "Advanced", icon: I.Gear, enabled: true },
    ],
  },
];

export function findSection(id: SectionId): NavItem | undefined {
  for (const g of SECTIONS) {
    for (const i of g.items) if (i.id === id) return i;
  }
  return undefined;
}

export function SettingsNav({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <nav className="settings-nav">
      {SECTIONS.map((g) => (
        <div key={g.label} className="settings-nav-group">
          <div className="settings-nav-label">{g.label}</div>
          {g.items.map((it) => {
            const Icon = it.icon;
            const disabled = !it.enabled;
            return (
              <button
                key={it.id}
                type="button"
                className={`settings-nav-item ${active === it.id ? "active" : ""} ${disabled ? "disabled" : ""}`}
                onClick={() => it.enabled && onSelect(it.id)}
                disabled={disabled}
                title={disabled ? "Coming soon" : it.label}
              >
                <span className="ico"><Icon /></span>
                <span className="lbl">{it.label}</span>
                {it.badge && <span className="badge">{it.badge}</span>}
              </button>
            );
          })}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <div className="settings-nav-foot">v{VERSION}</div>
    </nav>
  );
}
