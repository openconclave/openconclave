import { Header, NewButton } from "@/components/layout/header";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Position } from "@xyflow/react";
import { buildMiniMapPath } from "@/components/editor/rounded-edge";
import type { ConclaveDefinition, ConclaveExportPayload } from "@openconclave/shared";

type ConclaveRow = { id: string; name: string; description?: string; enabled: boolean; definition: ConclaveDefinition };
import { GitBranch, Play, Clock, Trash2, Square, Loader2, Power, MessageSquare, ChevronDown, LayoutGrid, List, Download, Upload } from "lucide-react";

const previewColors: Record<string, string> = {
  trigger: "oklch(0.65 0.18 170)",
  output: "oklch(0.65 0.18 170)",
  agent: "oklch(0.68 0.14 65)",
  discussion: "oklch(0.68 0.14 65)",
  condition: "oklch(0.65 0.18 290)",
  code: "oklch(0.65 0.18 290)",
  merge: "oklch(0.65 0.18 290)",
  file: "oklch(0.65 0.18 290)",
  prompt: "oklch(0.65 0.18 170)",
};

const handlePos: Record<string, Position> = {
  top: Position.Top, bottom: Position.Bottom,
  left: Position.Left, right: Position.Right,
  participants: Position.Left,
  true: Position.Bottom, false: Position.Bottom,
  full: Position.Bottom, last: Position.Bottom, summary: Position.Bottom,
};

function ConclavePreview({ nodes, edges }: { nodes?: any[]; edges?: any[] }) {
  const svg = useMemo(() => {
    if (!nodes?.length) return null;
    const dims = nodes.map((n) => {
      const w = n.data?.type === "discussion" ? 280 : 240;
      const h = n.data?.type === "discussion" ? 200 : 80;
      return { ...n, w, h };
    });
    const pad = 20;
    const minX = Math.min(...dims.map((n) => n.position.x)) - pad;
    const minY = Math.min(...dims.map((n) => n.position.y)) - pad;
    const maxX = Math.max(...dims.map((n) => n.position.x + n.w)) + pad;
    const maxY = Math.max(...dims.map((n) => n.position.y + n.h)) + pad;
    const vw = maxX - minX;
    const vh = maxY - minY;

    const nodeMap = new Map(dims.map((n) => [n.id, n]));

    function getXY(nodeId: string, handleId: string | undefined): [number, number, Position] {
      const nd = nodeMap.get(nodeId);
      if (!nd) return [0, 0, Position.Bottom];
      const p = handlePos[handleId ?? "bottom"] ?? Position.Bottom;
      switch (p) {
        case Position.Top: return [nd.position.x + nd.w / 2, nd.position.y, p];
        case Position.Bottom: return [nd.position.x + nd.w / 2, nd.position.y + nd.h, p];
        case Position.Left: return [nd.position.x, nd.position.y + nd.h / 2, p];
        case Position.Right: return [nd.position.x + nd.w, nd.position.y + nd.h / 2, p];
      }
    }

    return { dims, minX, minY, vw, vh, nodeMap, getXY, edges: edges ?? [] };
  }, [nodes, edges]);

  if (!svg) return <div className="h-[100px]" />;

  return (
    <svg
      viewBox={`${svg.minX} ${svg.minY} ${svg.vw} ${svg.vh}`}
      className="w-full h-[140px]"
      preserveAspectRatio="xMidYMid meet"
    >
      {svg.edges.map((e: any) => {
        const [sx, sy, sp] = svg.getXY(e.source, e.sourceHandle);
        const [tx, ty, tp] = svg.getXY(e.target, e.targetHandle);
        const d = buildMiniMapPath(sx, sy, sp, tx, ty, tp);
        return <path key={e.id ?? `${e.source}-${e.target}`} d={d} fill="none" stroke="oklch(0.40 0.04 260)" strokeWidth={3} />;
      })}
      {svg.dims.map((n: any) => {
        const color = previewColors[n.data?.type ?? ""] ?? "oklch(0.55 0.10 260)";
        const rx = Math.min(n.w, n.h) * 0.12;
        return (
          <rect
            key={n.id}
            x={n.position.x} y={n.position.y}
            width={n.w} height={n.h}
            rx={rx} ry={rx}
            fill="none" stroke={color} strokeWidth={3}
          />
        );
      })}
    </svg>
  );
}
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";

type ScheduleEntry = { conclaveId: string; cron: string; nextRun: string; enabled: boolean };
type ActiveRun = { id: number; conclaveId: number; status: string };

// ── Inline-editable conclave name ─────────────────────────────

function InlineName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLHeadingElement>(null);

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditing(true);
  }, []);

  const commit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const trimmed = (el.textContent ?? "").trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    } else {
      el.textContent = name;
    }
    setEditing(false);
  }, [name, onRename]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]);

  return (
    <h3
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={startEditing}
      onBlur={commit}
      onClick={editing ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
      onKeyDown={editing ? (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { ref.current!.textContent = name; setEditing(false); }
        e.stopPropagation();
      } : undefined}
      className={cn(
        "font-semibold truncate outline-none",
        editing && "truncate-none shadow-[0_0_0_1px_oklch(0.68_0.12_70/0.4)] rounded px-1 -mx-1"
      )}
    >
      {name}
    </h3>
  );
}

async function exportConclave(e: React.MouseEvent, id: string) {
  e.preventDefault();
  e.stopPropagation();
  try {
    const res = await fetch(`/api/conclaves/${id}/export`);
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="(.+)"/);
    const filename = match?.[1] ?? "conclave.json";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported", "success");
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, "error");
  }
}

// ── Import Dialog ───────────────────────────────────────────

interface ProviderInfo {
  id: string;
  name: string;
}

function ImportDialog({
  payload,
  onClose,
  onImported,
}: {
  payload: ConclaveExportPayload;
  onClose: () => void;
  onImported: () => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [mappings, setMappings] = useState<Record<string, { engine?: string; model?: string; ollamaModel?: string; providerId?: string; openaiModel?: string }>>({});
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then((d: { providers: ProviderInfo[] }) => {
      setProviders(d.providers ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const initial: typeof mappings = {};
    for (const role of payload.roles) {
      initial[role.id] = { ...role.original };
    }
    setMappings(initial);
  }, [payload.roles]);

  const updateMapping = (roleId: string, engine: string, extra?: Record<string, string>) => {
    setMappings((prev) => ({
      ...prev,
      [roleId]: { engine, ...extra },
    }));
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await api.post("/conclaves/import", { payload, roleMappings: mappings });
      toast(`Imported "${payload.conclave.name}"`, "success");
      onImported();
      onClose();
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative rounded-xl border border-border bg-card p-6 shadow-2xl w-[520px] max-h-[80vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-150">
        <h3 className="text-lg font-semibold">Import Conclave</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          "{payload.conclave.name}" &mdash; {payload.conclave.nodes.length} nodes, exported from OC v{payload.ocVersion}
        </p>

        {payload.roles.length > 0 && (
          <div className="mt-5">
            <h4 className="text-sm font-medium mb-3">Map provider roles</h4>
            <div className="space-y-3">
              {payload.roles.map((role) => (
                <div key={role.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{role.label}</span>
                    <span className="text-xs text-muted-foreground">{role.nodeIds.length} node{role.nodeIds.length > 1 ? "s" : ""}</span>
                  </div>
                  <select
                    value={mappings[role.id]?.engine ?? "claude"}
                    onChange={(e) => updateMapping(role.id, e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="claude">Claude</option>
                    <option value="ollama">Ollama</option>
                    <option value="openai">OpenAI-compatible</option>
                    <option value="debug">Debug</option>
                  </select>

                  {mappings[role.id]?.engine === "claude" && (
                    <select
                      value={mappings[role.id]?.model ?? "sonnet"}
                      onChange={(e) => updateMapping(role.id, "claude", { model: e.target.value })}
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                    >
                      <option value="sonnet">Sonnet</option>
                      <option value="opus">Opus</option>
                      <option value="haiku">Haiku</option>
                    </select>
                  )}

                  {mappings[role.id]?.engine === "openai" && providers.length > 0 && (
                    <select
                      value={mappings[role.id]?.providerId ?? ""}
                      onChange={(e) => updateMapping(role.id, "openai", { providerId: e.target.value })}
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                    >
                      <option value="">Select provider...</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {payload.knowledgeBases.length > 0 && (
          <div className="mt-5">
            <h4 className="text-sm font-medium mb-2">Knowledge bases (created empty)</h4>
            <div className="space-y-1">
              {payload.knowledgeBases.map((kb) => (
                <div key={kb.originalId} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="w-2 h-2 rounded-full bg-info" />
                  {kb.name}{kb.description && ` — ${kb.description}`}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

type SortBy = "name" | "created" | "modified";
type SortOrder = "asc" | "desc";
type ViewMode = "grid" | "list";

export function ConclavesPage() {
  const [conclaves, setConclaves] = useState<ConclaveDefinition[]>([]);
  const [schedule, setSchedule] = useState<Map<string, ScheduleEntry>>(new Map());
  const [activeRuns, setActiveRuns] = useState<Map<string, ActiveRun>>(new Map());
  const [sortBy, setSortBy] = useState<SortBy>("modified");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortOpen, setSortOpen] = useState(false);
  const [importPayload, setImportPayload] = useState<ConclaveExportPayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api
      .get<{ conclaves: ConclaveRow[] }>("/conclaves")
      .then((d) =>
        setConclaves(
          d.conclaves.map((w) => ({
            ...w.definition,
            id: w.id,
            name: w.name,
            description: w.description,
            enabled: w.enabled,
          }))
        )
      )
      .catch(() => setConclaves([]));

    api
      .get<{ schedule: ScheduleEntry[] }>("/scheduler")
      .then((d) => {
        const map = new Map<string, ScheduleEntry>();
        for (const s of d.schedule) map.set(s.conclaveId, s);
        setSchedule(map);
      })
      .catch(() => setSchedule(new Map()));
  };

  const loadRuns = () => {
    api
      .get<{ runs: ActiveRun[] }>("/runs")
      .then((d) => {
        const map = new Map<string, ActiveRun>();
        for (const r of d.runs) {
          if (r.status === "running" || r.status === "queued") {
            const wfId = String(r.conclaveId);
            if (!map.has(wfId)) map.set(wfId, r);
          }
        }
        setActiveRuns(map);
      })
      .catch(() => setActiveRuns(new Map()));
  };

  const handleStop = async (e: React.MouseEvent, run: ActiveRun) => {
    e.preventDefault();
    e.stopPropagation();
    await api.post(`/runs/${run.id}/cancel`, {});
    loadRuns();
  };

  useEffect(() => { load(); }, []);

  // Poll for active runs
  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 3000);
    return () => clearInterval(interval);
  }, []);

  const deleteConclave = async (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = await confirm("Delete conclave", `Are you sure you want to delete "${name}"? This cannot be undone.`);
    if (!confirmed) return;
    await api.delete(`/conclaves/${id}`);
    load();
  };

  const toggleEnabled = async (e: React.MouseEvent, wf: ConclaveDefinition) => {
    e.preventDefault();
    e.stopPropagation();
    await api.put(`/conclaves/${wf.id}`, { enabled: !wf.enabled });
    await api.post("/scheduler/sync", {});
    load();
  };

  const handleStart = (e: React.MouseEvent, wf: ConclaveDefinition) => {
    e.preventDefault();
    e.stopPropagation();
    const triggerNode = wf.nodes?.find((n) => n.data?.type === "trigger");
    const triggerConfig = triggerNode?.data?.config as Record<string, unknown> | undefined;
    if (triggerConfig?.type === "chat") {
      const toolName = wf.toolName;
      if (toolName) {
        window.open(`/${toolName}/chat`, "_blank");
      } else {
        toast("Set a tool name first (in conclave settings) to use chat", "error");
      }
      return;
    }
    api.post(`/conclaves/${wf.id}/run`, {})
      .then(() => { loadRuns(); toast(`Started ${wf.name}`, "success"); })
      .catch((err: Error) => toast(`Failed: ${err.message}`, "error"));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result as string) as ConclaveExportPayload;
        if (payload.formatVersion !== 1 || !payload.conclave) {
          toast("Invalid conclave file format", "error");
          return;
        }
        setImportPayload(payload);
      } catch {
        toast("Failed to parse JSON file", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const sortLabels: Record<SortBy, string> = { name: "Alphabetical", created: "Date created", modified: "Last modified" };

  const sortedConclaves = [...conclaves].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "name") cmp = (a.name ?? "").localeCompare(b.name ?? "");
    else if (sortBy === "created") cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    else cmp = (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
    return sortOrder === "asc" ? cmp : -cmp;
  });

  return (
    <>
      <Header
        title="Conclaves"
        actions={
          <div className="flex items-center gap-2">
            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {sortLabels[sortBy]}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {sortOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-border bg-card shadow-lg py-1">
                    <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Sort by</p>
                    {(["name", "created", "modified"] as SortBy[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => { setSortBy(s); setSortOpen(false); }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors",
                          sortBy === s ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        <span className="w-4 text-xs">{sortBy === s ? "✓" : ""}</span>
                        {sortLabels[s]}
                      </button>
                    ))}
                    <div className="border-t border-border/50 my-1" />
                    <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Order</p>
                    <button
                      onClick={() => { setSortOrder("asc"); setSortOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors",
                        sortOrder === "asc" ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <span className="w-4 text-xs">{sortOrder === "asc" ? "✓" : ""}</span>
                      Oldest first
                    </button>
                    <button
                      onClick={() => { setSortOrder("desc"); setSortOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors",
                        sortOrder === "desc" ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <span className="w-4 text-xs">{sortOrder === "desc" ? "✓" : ""}</span>
                      Newest first
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* View mode toggle */}
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "p-1.5 transition-colors",
                  viewMode === "grid" ? "bg-accent text-foreground" : "bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-1.5 transition-colors",
                  viewMode === "list" ? "bg-accent text-foreground" : "bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              title="Import conclave from file"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileSelect}
            />

            <NewButton
              label="New Conclave"
              onClick={() => (window.location.href = "/conclaves/new")}
            />
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {sortedConclaves.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <GitBranch className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No conclaves yet</p>
            <p className="text-sm mt-1">
              Create your first conclave to start orchestrating AI agents.
            </p>
          </div>
        ) : (
          <div className={viewMode === "grid" ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" : "flex flex-col gap-2"}>
            {sortedConclaves.map((wf) => {
              const sched = schedule.get(wf.id);
              const activeRun = activeRuns.get(String(wf.id));
              const triggerNode = wf.nodes?.find((n) => n.data?.type === "trigger");
              const isChat = (triggerNode?.data?.config as Record<string, unknown> | undefined)?.type === "chat";
              return (
                <a
                  key={wf.id}
                  href={`/conclaves/${wf.id}`}
                  className={cn(
                    "rounded-lg border bg-card hover:border-primary/50 transition-colors flex flex-col",
                    wf.enabled ? "border-border" : "border-border opacity-60",
                    activeRun && "!border-warning/60 shadow-[0_0_12px_-2px] shadow-warning/30"
                  )}
                >
                  {/* Preview */}
                  {viewMode === "grid" && wf.nodes && wf.nodes.length > 0 && (
                    <div className="border-b border-border/30 px-4 pt-3 pb-1">
                      <ConclavePreview nodes={wf.nodes} edges={wf.edges} />
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-4 flex-1">
                    <InlineName
                      name={wf.name}
                      onRename={(newName) => {
                        api.put(`/conclaves/${wf.id}`, { name: newName }).then(() => load());
                      }}
                    />
                    {wf.description && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {wf.description}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{wf.nodes?.length ?? 0} nodes</span>
                      <span>&middot;</span>
                      {activeRun ? (
                        <span className="flex items-center gap-1 text-warning">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Running (#{activeRun.id})
                        </span>
                      ) : (
                        <span className={wf.enabled ? "text-success" : "text-muted-foreground"}>
                          {wf.enabled ? "Active" : "Disabled"}
                        </span>
                      )}
                    </div>
                    {sched && sched.enabled && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-info">
                        <Clock className="h-3 w-3" />
                        <span>Next run: {new Date(sched.nextRun).toLocaleTimeString()}</span>
                        <span className="text-muted-foreground">({sched.cron})</span>
                      </div>
                    )}
                  </div>

                  {/* Action bar */}
                  <div className="border-t border-border/50 px-3 py-2 flex items-center gap-1.5">
                    {activeRun ? (
                      <button
                        onClick={(e) => handleStop(e, activeRun)}
                        className="flex h-7 items-center gap-1.5 rounded-md bg-destructive/15 text-destructive px-2.5 hover:bg-destructive/25 transition-colors"
                        title="Stop running conclave"
                      >
                        <Square className="h-3 w-3" />
                        <span className="text-[11px] font-medium">Stop</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleStart(e, wf)}
                        className={cn(
                          "flex h-7 items-center gap-1.5 rounded-md px-2.5 transition-colors",
                          isChat
                            ? "bg-primary/15 text-primary hover:bg-primary/25"
                            : "bg-success/15 text-success hover:bg-success/25"
                        )}
                        title={isChat ? "Open chat" : "Start conclave"}
                      >
                        {isChat ? <MessageSquare className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        <span className="text-[11px] font-medium">{isChat ? "Chat" : "Start"}</span>
                      </button>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={(e) => exportConclave(e, wf.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-primary/15 hover:text-primary transition-colors"
                      title="Export conclave"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => toggleEnabled(e, wf)}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                        wf.enabled
                          ? "text-success hover:bg-success/15"
                          : "text-muted-foreground/50 hover:bg-muted"
                      )}
                      title={wf.enabled ? "Disable conclave" : "Enable conclave"}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => deleteConclave(e, wf.id, wf.name)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-destructive/15 hover:text-destructive transition-colors"
                      title="Delete conclave"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>

      {importPayload && (
        <ImportDialog
          payload={importPayload}
          onClose={() => setImportPayload(null)}
          onImported={load}
        />
      )}
    </>
  );
}
