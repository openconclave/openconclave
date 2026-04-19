import type { SVGProps } from "react";

export const I = {
  Check: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  X: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  ArrowR: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  ArrowL: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  Chevron: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  Terminal: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  Bolt: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Play: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <polygon points="6 3 21 12 6 21 6 3" />
    </svg>
  ),
  Plus: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Spark: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9-1.9 5.6-1.9-5.6-5.6-1.9 5.6-1.9L12 3z" />
    </svg>
  ),
  Book: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  Upload: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  Eye: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ),
  Send: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  Loader: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="ob-spin" {...p}>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  ),
  Copy: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  External: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
};

/* Topology preview shown on the Welcome step */
export function TopologyPreview() {
  return (
    <svg width="520" height="130" viewBox="0 0 520 130" style={{ opacity: 0.95, maxWidth: "100%" }}>
      <g transform="translate(10,48)">
        <rect className="node-box node-trigger" width="96" height="34" rx="8" />
        <text x="12" y="16" fill="var(--text)" fontSize="10.5" fontWeight="600">Trigger</text>
        <text x="12" y="28" fill="var(--text-faint)" fontSize="9" fontFamily="var(--font-mono)">CHAT</text>
      </g>
      <g transform="translate(170,14)">
        <rect className="node-box node-agent" width="120" height="34" rx="8" />
        <text x="12" y="16" fill="var(--text)" fontSize="10.5" fontWeight="600">Sunk Cost</text>
        <text x="12" y="28" fill="var(--text-faint)" fontSize="9" fontFamily="var(--font-mono)">CLAUDE · SONNET</text>
      </g>
      <g transform="translate(170,82)">
        <rect className="node-box node-agent" width="120" height="34" rx="8" />
        <text x="12" y="16" fill="var(--text)" fontSize="10.5" fontWeight="600">Opportunity Cost</text>
        <text x="12" y="28" fill="var(--text-faint)" fontSize="9" fontFamily="var(--font-mono)">CLAUDE · SONNET</text>
      </g>
      <g transform="translate(340,48)">
        <rect className="node-box node-code" width="110" height="34" rx="8" />
        <text x="12" y="16" fill="var(--text)" fontSize="10.5" fontWeight="600">Detect overlap</text>
        <text x="12" y="28" fill="var(--text-faint)" fontSize="9" fontFamily="var(--font-mono)">PYTHON</text>
      </g>
      <g transform="translate(470,48)">
        <rect className="node-box node-output" width="40" height="34" rx="8" />
        <path d="M12 18 l8 -6 l-8 -6 z" transform="translate(10,9)" fill="none" stroke="var(--trigger)" strokeWidth="1.3" />
      </g>
      <path className="edge" d="M106 65 C 140 65, 140 31, 170 31" />
      <path className="edge" d="M106 65 C 140 65, 140 99, 170 99" />
      <path className="edge" d="M290 31 C 320 31, 320 65, 340 65" />
      <path className="edge" d="M290 99 C 320 99, 320 65, 340 65" />
      <path className="edge" d="M450 65 L 470 65" />
    </svg>
  );
}

/* Per-starter SVG topology mini-preview */
export function StarterViz({ kind }: { kind: "ledger" | "review" | "advisors" | "empty" }) {
  const s = { fill: "var(--bg-1)", strokeWidth: 1.3 } as const;
  if (kind === "empty") {
    return (
      <svg width="160" height="88" viewBox="0 0 160 88">
        <rect x="1" y="1" width="158" height="86" rx="10" fill="none" stroke="var(--border-strong)" strokeDasharray="4 4" opacity="0.5" />
        <g transform="translate(72,36)" stroke="var(--text-faint)" strokeWidth="1.5" fill="none" strokeLinecap="round">
          <line x1="8" y1="0" x2="8" y2="16" />
          <line x1="0" y1="8" x2="16" y2="8" />
        </g>
      </svg>
    );
  }
  if (kind === "ledger") {
    return (
      <svg width="240" height="110" viewBox="0 0 240 110">
        <rect x="92" y="2" width="70" height="20" rx="5" {...s} stroke="var(--trigger)" />
        <rect x="10" y="44" width="70" height="20" rx="5" {...s} stroke="var(--agent)" />
        <rect x="10" y="72" width="70" height="20" rx="5" {...s} stroke="var(--agent)" />
        <rect x="92" y="58" width="70" height="20" rx="5" {...s} stroke="var(--code)" />
        <rect x="175" y="58" width="55" height="20" rx="5" {...s} stroke="var(--trigger)" />
        <path d="M127 22 L127 58" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M80 54 L92 66" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M80 82 L92 72" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M162 68 L175 68" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
      </svg>
    );
  }
  if (kind === "review") {
    return (
      <svg width="240" height="110" viewBox="0 0 240 110">
        <rect x="92" y="2" width="70" height="20" rx="5" {...s} stroke="var(--trigger)" />
        <rect x="10" y="40" width="60" height="18" rx="5" {...s} stroke="var(--agent)" />
        <rect x="90" y="40" width="60" height="18" rx="5" {...s} stroke="var(--agent)" />
        <rect x="170" y="40" width="60" height="18" rx="5" {...s} stroke="var(--agent)" />
        <rect x="70" y="74" width="100" height="18" rx="5" {...s} stroke="var(--code)" />
        <path d="M127 22 L127 40" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M40 22 C 40 32, 127 32, 127 40" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M200 22 C 200 32, 127 32, 127 40" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M40 58 C 40 68, 120 68, 120 74" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M120 58 L120 74" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
        <path d="M200 58 C 200 68, 120 68, 120 74" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
      </svg>
    );
  }
  // advisors
  return (
    <svg width="240" height="110" viewBox="0 0 240 110">
      <rect x="92" y="2" width="70" height="20" rx="5" {...s} stroke="var(--trigger)" />
      <rect x="20" y="44" width="54" height="18" rx="5" {...s} stroke="var(--agent)" />
      <rect x="95" y="44" width="54" height="18" rx="5" {...s} stroke="var(--agent)" />
      <rect x="170" y="44" width="54" height="18" rx="5" {...s} stroke="var(--agent)" />
      <rect x="80" y="80" width="84" height="18" rx="5" {...s} stroke="var(--trigger)" />
      <path d="M127 22 L127 44" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
      <path d="M47 22 C 47 32, 127 32, 127 44" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
      <path d="M197 22 C 197 32, 127 32, 127 44" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
      <path d="M47 62 C 47 72, 122 72, 122 80" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
      <path d="M122 62 L122 80" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
      <path d="M197 62 C 197 72, 122 72, 122 80" stroke="var(--edge)" strokeWidth="1.1" fill="none" opacity="0.6" />
    </svg>
  );
}

export type StepId =
  | "welcome"
  | "cc"
  | "provider"
  | "ollama"
  | "starter"
  | "run"
  | "ready";

export interface StepDef {
  id: StepId;
  label: string;
}

export const STEPS: StepDef[] = [
  { id: "welcome", label: "Welcome" },
  { id: "cc", label: "Claude Code" },
  { id: "provider", label: "AI Provider" },
  { id: "ollama", label: "Ollama" },
  { id: "starter", label: "First Conclave" },
  { id: "run", label: "First Run" },
  { id: "ready", label: "Ready" },
];

export function Sidebar({
  current,
  onNav,
  version,
}: {
  current: number;
  onNav: (i: number) => void;
  version: string;
}) {
  return (
    <aside className="ob-sidebar">
      <div className="brand">
        <div className="brand-mark">OC</div>
        <div className="brand-name">OpenConclave</div>
      </div>
      <div className="steps">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "";
          const clickable = i <= current;
          return (
            <button
              key={s.id}
              className={`step ${state}`}
              onClick={() => clickable && onNav(i)}
              disabled={!clickable}
              type="button"
            >
              <div className="step-num">
                {i < current ? <I.Check style={{ width: 12, height: 12 }} /> : i + 1}
              </div>
              <div>{s.label}</div>
            </button>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <div>You can change any of these later in <strong>Settings</strong>.</div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 6, color: "var(--ok)" }}>
          <span className="ds-dot" />
          <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            v{version} · local
          </span>
        </div>
      </div>
    </aside>
  );
}

/* Starter definitions shared between starter + first-run + ready steps.
   Most entries come live from the marketplace; "empty" is the synthetic
   blank-slate option we always present alongside. */
export type StarterId = string;
export type StarterVizKind = "ledger" | "review" | "advisors" | "empty";

export interface Starter {
  id: StarterId;
  title: string;
  toolName: string;
  desc: string;
  nodes: number;
  needs: Array<"anthropic" | "ollama">;
  viz: StarterVizKind;
}

export const EMPTY_STARTER: Starter = {
  id: "empty",
  title: "Start from blank",
  toolName: "your_tool_name",
  desc: "Open the visual editor and build your first conclave from scratch. You can import a starter anytime.",
  nodes: 0,
  needs: [],
  viz: "empty",
};
