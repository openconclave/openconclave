import { useMemo, useState, useTransition } from "react";
import Markdown from "react-markdown";
import type { AgentTask, RunEvent, RunDetailResponse } from "@openconclave/shared";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import {
  RI,
  StatusPill,
  Metric,
  nodeIcon,
  nodeKindOf,
  formatDuration,
  formatSize,
  formatCost,
  type UINodeType,
} from "./atoms";
import { Gantt } from "./gantt";
import type { ConclaveMeta } from "./list";

type ArtifactInfo = { filename: string; path: string; size: number; createdAt: string };

interface DetailProps {
  data: RunDetailResponse;
  conclaveMeta?: ConclaveMeta;
  nodeLabels: Map<string, string>;
  nodeTypes: Map<string, string>;
  artifacts: ArtifactInfo[];
  artifactsDir: string;
  chatUrl: string | null;
  onRefresh: () => void;
}

type TabId = "timeline" | "tasks" | "artifacts" | "events" | "input";

export function RunDetail(props: DetailProps) {
  const [tab, setTab] = useState<TabId>("timeline");
  const { data, conclaveMeta, nodeLabels, nodeTypes, artifacts, artifactsDir, chatUrl, onRefresh } = props;
  const { run, tasks, events } = data;

  const duration = formatDuration(run.startedAt, run.completedAt);
  const totalCost = tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
  const totalTokens = tasks.reduce((sum, t) => sum + (t.tokensUsed ?? 0), 0);

  const isActive = run.status === "running" || run.status === "queued";
  const canResume =
    (run.status === "failure" || run.status === "interrupted" || run.status === "cancelled") &&
    data.checkpoint != null;

  const channelInfo = useMemo(() => detectChannelExchange(events), [events]);

  const handleCancel = async () => {
    try {
      await api.post(`/runs/${run.id}/cancel`, {});
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel run", "error");
    }
  };

  const [isResuming, startResume] = useTransition();
  const handleResume = () =>
    startResume(async () => {
      try {
        const result = await api.post<{ runId: number }>(`/runs/${run.id}/resume`, {});
        if (typeof result.runId !== "number") throw new Error("Invalid server response");
        window.location.href = `/runs/${result.runId}`;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to resume run", "error");
      }
    });

  const [isRerunning, startRerun] = useTransition();
  const handleRerun = () =>
    startRerun(async () => {
      try {
        const input = run.triggerPayload ?? {};
        const res = await api.post<{ runId: number }>(`/conclaves/${run.conclaveId}/run`, input);
        if (typeof res.runId !== "number") throw new Error("Invalid server response");
        window.location.href = `/runs/${res.runId}`;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to re-run", "error");
      }
    });

  return (
    <div className="runs-detail">
      <div className="detail-head">
        <div className="detail-breadcrumb">
          <span>Runs</span>
          <span>/</span>
          <span>{conclaveMeta?.name ?? "Conclave"}</span>
          <span>/</span>
          <span className="id">#{run.id}</span>
        </div>

        <div className="detail-title">
          <StatusPill status={run.status} />
          <h1>{conclaveMeta?.name ?? "Run"}</h1>
          <div className="detail-actions">
            {chatUrl && (
              <a className="runs-btn secondary" href={chatUrl}>
                <RI.Bubble /> Continue chat
              </a>
            )}
            {isActive && (
              <button className="runs-btn danger" onClick={handleCancel}>
                <RI.Stop /> Stop
              </button>
            )}
            {canResume && (
              <button className="runs-btn info" onClick={handleResume} disabled={isResuming}>
                {isResuming ? <RI.Loader /> : <RI.Resume />}
                {isResuming ? "Resuming…" : "Resume from checkpoint"}
              </button>
            )}
            {!isActive && (
              <button className="runs-btn secondary" onClick={handleRerun} disabled={isRerunning}>
                {isRerunning ? <RI.Loader /> : <RI.Rerun />}
                Re-run
              </button>
            )}
          </div>
        </div>

        <div className="metrics">
          <Metric
            label="Trigger"
            value={cap(run.triggerType ?? "manual")}
            sub={run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : undefined}
            icon={<RI.Play />}
          />
          <Metric
            label="Duration"
            value={duration ?? "—"}
            sub={run.completedAt ? `ended ${new Date(run.completedAt).toLocaleTimeString()}` : isActive ? "in progress" : undefined}
            icon={<RI.Clock />}
          />
          <Metric
            label="Agents"
            value={String(tasks.length)}
            sub={`${new Set(tasks.map((t) => t.nodeId)).size} unique`}
            icon={<RI.Sparkles />}
          />
          <Metric
            label="Tokens"
            value={totalTokens > 0 ? fmtTokens(totalTokens) : "—"}
            icon={<RI.Hash />}
          />
          <Metric
            label="Cost"
            value={formatCost(totalCost)}
            icon={<RI.Coin />}
            accent
          />
        </div>

        {run.error && (
          <div style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            background: "oklch(0.4 0.15 25 / 0.12)",
            border: "1px solid oklch(0.5 0.15 25 / 0.3)",
            color: "var(--danger)",
            fontSize: 12.5,
          }}>
            {run.error}
          </div>
        )}
      </div>

      <div className="detail-tabs">
        <Tab id="timeline" active={tab} onSelect={setTab} icon={<RI.Chart />} label="Timeline" />
        <Tab id="tasks" active={tab} onSelect={setTab} icon={<RI.Sparkles />} label="Agent tasks" count={tasks.length} />
        <Tab id="artifacts" active={tab} onSelect={setTab} icon={<RI.Doc />} label="Artifacts" count={artifacts.length} />
        <Tab id="events" active={tab} onSelect={setTab} icon={<RI.Terminal />} label="Events" count={events.length} />
        <Tab id="input" active={tab} onSelect={setTab} icon={<RI.Bubble />} label="Input" />
      </div>

      <div className="detail-body">
        {tab === "timeline" && (
          <>
            {channelInfo && (
              <div className="channel-banner">
                <div className="ci"><RI.Bubble /></div>
                <div>
                  <div className="t">Channel exchange detected{channelInfo.nodeLabel ? ` — ${channelInfo.nodeLabel}` : ""}</div>
                  <div className="s">
                    {channelInfo.count} message{channelInfo.count !== 1 ? "s" : ""}
                    {channelInfo.firstAtRelative && ` · first at ${channelInfo.firstAtRelative}`}
                    {channelInfo.resolvedInSec != null && ` · resolved in ${channelInfo.resolvedInSec.toFixed(1)}s`}
                  </div>
                </div>
              </div>
            )}
            <div className="tl-section">
              <div className="tl-head">
                <h2>Execution timeline</h2>
                <div style={{ flex: 1 }} />
                <div className="legend">
                  <span><span className="sw" style={{ background: "var(--trigger)" }} /> trigger</span>
                  <span><span className="sw" style={{ background: "var(--agent)" }} /> agent</span>
                  <span><span className="sw" style={{ background: "var(--code)" }} /> code</span>
                  <span><span className="sw" style={{ background: "var(--edge)" }} /> logic</span>
                  <span><span className="sw" style={{ background: "#7aa7ff" }} /> I/O</span>
                </div>
              </div>
              <Gantt
                run={run}
                tasks={tasks}
                events={events}
                nodeLabels={nodeLabels}
                nodeTypes={nodeTypes}
              />
            </div>
          </>
        )}

        {tab === "tasks" && (
          <TasksPanel tasks={tasks} events={events} nodeLabels={nodeLabels} nodeTypes={nodeTypes} />
        )}

        {tab === "artifacts" && (
          <ArtifactsPanel artifacts={artifacts} artifactsDir={artifactsDir} runId={run.id} />
        )}

        {tab === "events" && <EventsPanel events={events} nodeLabels={nodeLabels} run={run} />}

        {tab === "input" && (
          <div className="input-block">
            <div className="label">Trigger input</div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {run.triggerPayload != null
                ? JSON.stringify(run.triggerPayload, null, 2)
                : "—"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function Tab({
  id,
  active,
  onSelect,
  icon,
  label,
  count,
}: {
  id: TabId;
  active: TabId;
  onSelect: (t: TabId) => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      className={`detail-tab ${active === id ? "active" : ""}`}
      onClick={() => onSelect(id)}
      type="button"
    >
      {icon}
      {label}
      {count != null && <span className="tab-count">{count}</span>}
    </button>
  );
}

/* ── Tasks panel ─────────────────────────────────────────── */

function TasksPanel({
  tasks,
  events,
  nodeLabels,
  nodeTypes,
}: {
  tasks: AgentTask[];
  events: RunEvent[];
  nodeLabels: Map<string, string>;
  nodeTypes: Map<string, string>;
}) {
  if (tasks.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>
        No agent tasks in this run.
      </div>
    );
  }
  return (
    <div className="tasks">
      {tasks.map((t, i) => (
        <TaskCard
          key={t.id}
          task={t}
          events={events}
          nodeLabels={nodeLabels}
          nodeTypes={nodeTypes}
          defaultOpen={i === 0}
        />
      ))}
    </div>
  );
}

function TaskCard({
  task,
  events,
  nodeLabels,
  nodeTypes,
  defaultOpen,
}: {
  task: AgentTask;
  events: RunEvent[];
  nodeLabels: Map<string, string>;
  nodeTypes: Map<string, string>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const label = nodeLabels.get(task.nodeId) ?? task.nodeId;
  const kind = nodeKindOf(nodeTypes.get(task.nodeId));
  const duration = formatDuration(task.startedAt, task.completedAt);

  const thinkingEvents = events.filter(
    (e) =>
      e.type === "agent:thinking" &&
      (e.data as Record<string, unknown> | undefined)?.taskId === task.id
  );

  const firstLine = typeof task.prompt === "string"
    ? (task.prompt.split("\n")[0] ?? "")
    : JSON.stringify(task.prompt).slice(0, 140);

  return (
    <div className={`task ${open ? "open" : ""}`}>
      <button className="task-head" onClick={() => setOpen(!open)} type="button">
        <span className="chev"><RI.Chev /></span>
        <span className={`ti ${kind}`}>{nodeIcon(kind)}</span>
        <div className="task-main">
          <div className="task-title">
            {label}
            {task.model && <span className="pill-small">{task.model}</span>}
          </div>
          <div className="task-subtitle">{firstLine}</div>
        </div>
        <div className="task-stats">
          {duration && <span><RI.Clock /> {duration}</span>}
          {task.tokensUsed != null && task.tokensUsed > 0 && <span><RI.Hash /> {fmtTokens(task.tokensUsed)}</span>}
          {task.costUsd != null && task.costUsd > 0 && <span><RI.Coin /> {formatCost(task.costUsd)}</span>}
        </div>
      </button>
      <div className="task-body">
        <div className="block-label">Prompt</div>
        <div className="block">
          <MdSafe>{typeof task.prompt === "string" ? task.prompt : JSON.stringify(task.prompt, null, 2)}</MdSafe>
        </div>
        {task.systemPrompt && (
          <>
            <div className="block-label">System prompt</div>
            <div className="block">
              <MdSafe>{task.systemPrompt}</MdSafe>
            </div>
          </>
        )}
        {thinkingEvents.length > 0 && (
          <>
            <div className="block-label">Thinking</div>
            {thinkingEvents.map((te) => {
              const blocks = Array.isArray((te.data as Record<string, unknown>)?.thinking)
                ? ((te.data as Record<string, unknown>).thinking as Array<{ thinking: string }>)
                : [];
              return blocks.map((b, i) => (
                <pre
                  key={`${te.id}-${i}`}
                  className="block thinking"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "pre-wrap" }}
                >
                  {b.thinking}
                </pre>
              ));
            })}
          </>
        )}
        {task.output != null && (
          <>
            <div className="block-label">Output</div>
            <div className="block">
              <MdSafe>{typeof task.output === "string" ? task.output : JSON.stringify(task.output, null, 2)}</MdSafe>
            </div>
          </>
        )}
        {task.error && (
          <>
            <div className="block-label">Error</div>
            <pre className="block error" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "pre-wrap" }}>
              {task.error}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function MdSafe({ children }: { children: string }) {
  return (
    <Markdown
      components={{
        p: ({ children }) => <p style={{ margin: "0 0 6px" }}>{children}</p>,
        pre: ({ children }) => (
          <pre style={{ background: "var(--bg-1)", padding: "8px 10px", borderRadius: 6, overflowX: "auto", margin: "6px 0" }}>
            {children}
          </pre>
        ),
        code: ({ children }) => (
          <code style={{ background: "#1a1613", padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
            {children}
          </code>
        ),
        ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ol>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{children}</a>
        ),
      }}
    >
      {children}
    </Markdown>
  );
}

/* ── Artifacts panel ─────────────────────────────────────── */

function ArtifactsPanel({
  artifacts,
  artifactsDir,
  runId,
}: {
  artifacts: ArtifactInfo[];
  artifactsDir: string;
  runId: number;
}) {
  if (artifacts.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>
        No artifacts in this run.
      </div>
    );
  }

  const handleCopy = (path: string) => {
    void navigator.clipboard.writeText(path);
    toast("Path copied", "success");
  };

  const handleReveal = async (filename: string) => {
    try {
      await fetch(`/api/runs/${runId}/artifacts/${encodeURIComponent(filename)}/reveal`, { method: "POST" });
    } catch (err) {
      toast(`Reveal failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  return (
    <>
      <div className="artifacts-grid">
        {artifacts.map((a) => (
          <div key={a.filename} className="artifact-card">
            <div className="artifact-head">
              <span className="ai"><RI.Doc /></span>
              <div className="artifact-main">
                <div className="artifact-name">{a.filename}</div>
                <div className="artifact-meta">
                  {formatSize(a.size)} · {new Date(a.createdAt).toLocaleTimeString()}
                </div>
              </div>
              <div className="artifact-actions">
                <button className="runs-btn ghost" onClick={() => handleCopy(a.path)} title="Copy path">
                  <RI.Copy />
                </button>
                <button className="runs-btn ghost" onClick={() => handleReveal(a.filename)} title="Reveal in file explorer">
                  <RI.Folder />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {artifactsDir && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          Location: {artifactsDir}
          <button
            className="runs-btn ghost"
            style={{ marginLeft: 8, padding: "2px 6px", fontSize: 11 }}
            onClick={() => handleCopy(artifactsDir)}
          >
            <RI.Copy /> copy
          </button>
        </div>
      )}
    </>
  );
}

/* ── Events panel ────────────────────────────────────────── */

const EVENT_TAGS: Record<string, { label: string; cls?: string }> = {
  "run:started": { label: "run" },
  "run:completed": { label: "run", cls: "ok" },
  "node:started": { label: "node" },
  "node:completed": { label: "node", cls: "ok" },
  "node:failed": { label: "node", cls: "err" },
  "node:skipped": { label: "skip" },
  "agent:started": { label: "agent" },
  "agent:output": { label: "agent" },
  "agent:thinking": { label: "think" },
  "agent:completed": { label: "agent", cls: "ok" },
  "channel:output": { label: "channel", cls: "warn" },
  "prompt:question": { label: "prompt", cls: "warn" },
};

function EventsPanel({
  events,
  nodeLabels,
  run,
}: {
  events: RunEvent[];
  nodeLabels: Map<string, string>;
  run: { startedAt?: string; createdAt: string };
}) {
  const origin = new Date(run.startedAt ?? run.createdAt).getTime();
  return (
    <div className="events-log">
      {events.map((e) => {
        const info = EVENT_TAGS[e.type] ?? { label: e.type };
        const ms = new Date(e.createdAt).getTime() - origin;
        const t = fmtOffset(ms);
        const label = e.nodeId ? nodeLabels.get(e.nodeId) ?? e.nodeId : info.label;
        return (
          <div className="line" key={e.id}>
            <span className="t">{t}</span>
            <span className={`tag ${info.cls ?? ""}`}>{label}</span>
            <span className={`msg ${info.cls === "ok" ? "" : "dim"}`}>{summarizeEvent(e)}</span>
          </div>
        );
      })}
    </div>
  );
}

function summarizeEvent(e: RunEvent): string {
  const d = e.data as Record<string, unknown> | undefined;
  if (e.type === "agent:output") {
    const chunk = d?.chunk as string | undefined;
    if (!chunk) return e.type;
    const one = chunk.replace(/\s+/g, " ").trim();
    return one.length > 120 ? one.slice(0, 120) + "…" : one;
  }
  if (e.type === "run:completed") return `${d?.status ?? ""}${d?.error ? ` — ${d.error}` : ""}`;
  if (e.type === "agent:completed") {
    const durMs = d?.durationMs as number | undefined;
    return `${d?.success ? "done" : "failed"}${durMs != null ? ` in ${(durMs / 1000).toFixed(1)}s` : ""}`;
  }
  if (d && typeof d === "object") {
    const short = JSON.stringify(d);
    return short.length > 120 ? short.slice(0, 120) + "…" : short;
  }
  return e.type;
}

function fmtOffset(ms: number): string {
  if (ms < 0) return "0:00.0";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

/* ── Channel detection ───────────────────────────────────── */

interface ChannelInfo {
  count: number;
  nodeLabel?: string;
  firstAtRelative?: string;
  resolvedInSec?: number;
}

function detectChannelExchange(events: RunEvent[]): ChannelInfo | null {
  const channelEvents = events.filter((e) => e.type === "prompt:question" || e.type === "channel:output");
  if (channelEvents.length === 0) return null;
  const firstQ = channelEvents.find((e) => e.type === "prompt:question");
  const firstAt = firstQ ? new Date(firstQ.createdAt).getTime() : new Date(channelEvents[0]!.createdAt).getTime();
  const lastAt = new Date(channelEvents[channelEvents.length - 1]!.createdAt).getTime();
  const origin = events[0] ? new Date(events[0].createdAt).getTime() : firstAt;
  return {
    count: channelEvents.filter((e) => e.type === "prompt:question").length,
    nodeLabel: firstQ?.nodeId ?? undefined,
    firstAtRelative: fmtOffset(firstAt - origin),
    resolvedInSec: lastAt > firstAt ? (lastAt - firstAt) / 1000 : undefined,
  };
}

/* kind lookup for Gantt (re-exported for completeness, not used here but consistent) */
export type { UINodeType };
