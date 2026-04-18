import type { SVGProps } from "react";
import type { RunStatus } from "@openconclave/shared";

export const RI = {
  Search: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Play: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M6 4l14 8-14 8z" /></svg>
  ),
  Refresh: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 12a9 9 0 0115-6.7L21 8" />
      <polyline points="21 3 21 8 16 8" />
      <path d="M21 12a9 9 0 01-15 6.7L3 16" />
      <polyline points="3 21 3 16 8 16" />
    </svg>
  ),
  Chev: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  ChevDown: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  Clock: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Zap: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Link: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
    </svg>
  ),
  Coin: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" /><path d="M12 6v12" /><path d="M15 9.5a3 3 0 00-3-1.5c-2 0-3 1-3 2s1 2 3 2 3 1 3 2-1 2-3 2a3 3 0 01-3-1.5" />
    </svg>
  ),
  Hash: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  ),
  Sparkles: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
      <path d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
    </svg>
  ),
  Code: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  Doc: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  ),
  Flow: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
      <line x1="7" y1="12" x2="10" y2="12" /><line x1="14" y1="12" x2="17" y2="12" />
    </svg>
  ),
  Bubble: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12a8 8 0 01-11.7 7.1L3 21l1.9-6.3A8 8 0 1121 12z" />
    </svg>
  ),
  Terminal: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  Chart: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="3 3 3 21 21 21" /><polyline points="7 14 11 10 15 14 20 9" />
    </svg>
  ),
  Rerun: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.5 15a9 9 0 11-2.1-9.4L23 10" />
    </svg>
  ),
  Stop: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
  ),
  Resume: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
    </svg>
  ),
  Loader: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "ob-spin 0.9s linear infinite" }} {...p}>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  ),
  Copy: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  External: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  Folder: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Share: (p: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
};

export type UINodeType =
  | "trigger" | "output"
  | "agent" | "discussion"
  | "code" | "transform"
  | "condition" | "merge" | "logic"
  | "file" | "prompt" | "knowledge" | "io";

export function nodeKindOf(type?: string): UINodeType {
  if (!type) return "logic";
  if (["trigger", "output"].includes(type)) return type as UINodeType;
  if (["agent", "discussion"].includes(type)) return type as UINodeType;
  if (["code", "transform"].includes(type)) return type as UINodeType;
  if (["condition", "merge"].includes(type)) return type as UINodeType;
  if (["file", "prompt", "knowledge"].includes(type)) return type as UINodeType;
  return "logic";
}

export function nodeIcon(kind: UINodeType) {
  if (kind === "trigger" || kind === "output") return <RI.Zap />;
  if (kind === "agent" || kind === "discussion") return <RI.Sparkles />;
  if (kind === "code" || kind === "transform") return <RI.Code />;
  if (kind === "condition" || kind === "merge" || kind === "logic") return <RI.Flow />;
  return <RI.Doc />;
}

export function StatusPill({ status }: { status: RunStatus | string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`status-pill ${status}`}>
      <span className="blip" />
      {label}
    </span>
  );
}

export function TriggerIcon({ kind }: { kind?: string }) {
  if (kind === "schedule" || kind === "cron") return <RI.Clock />;
  if (kind === "webhook") return <RI.Link />;
  if (kind === "api" || kind === "mcp") return <RI.Zap />;
  return <RI.Play />;
}

export function Metric({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`metric${accent ? " accent" : ""}`}>
      <div className="k">{icon}{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function formatDuration(startedAt?: string | null, completedAt?: string | null, fallbackMs?: number | null): string | null {
  if (startedAt && completedAt) {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return fmtMs(ms);
  }
  if (fallbackMs != null) return fmtMs(fallbackMs);
  return null;
}

function fmtMs(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}m ${s.toFixed(1)}s`;
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = (now - then) / 60000;
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${Math.round(diffMin)}m ago`;
  const diffHr = diffMin / 60;
  if (diffHr < 24) return `${Math.round(diffHr)}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCost(cost?: number | null): string {
  if (cost == null) return "—";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
