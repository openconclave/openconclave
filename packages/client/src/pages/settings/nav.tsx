import type { ReactElement, SVGProps } from "react";
import { VERSION } from "@openconclave/shared";

export type SectionId =
  | "marketplace"
  | "models"
  | "knowledge"
  | "integrations"
  | "web-search"
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
  Store: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9h16v11H4z" />
      <path d="M8 9v4a2 2 0 0 0 4 0V9M12 9v4a2 2 0 0 0 4 0V9" />
    </svg>
  ),
  Brain: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="8" cy="7" r="4" /><circle cx="16" cy="7" r="4" /><path d="M12 11v10" /><path d="M8 21h8" />
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
  Gear: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

export const SECTIONS: NavGroup[] = [
  {
    label: "Library",
    items: [
      { id: "marketplace", label: "Marketplace", icon: I.Store, enabled: true },
    ],
  },
  {
    label: "AI",
    items: [
      { id: "models", label: "Models & providers", icon: I.Brain, enabled: true },
      { id: "knowledge", label: "Knowledge", icon: I.Book, enabled: true },
    ],
  },
  {
    label: "Connect",
    items: [
      { id: "integrations", label: "Integrations", icon: I.Plug, enabled: true },
      { id: "web-search", label: "Web search", icon: I.Search, enabled: true },
    ],
  },
  {
    label: "System",
    items: [
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
