import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { RunDetailResponse } from "@openconclave/shared";
import "./runs.css";
import {
  RunsHeader,
  RunsFilters,
  RunsList,
  filterRuns,
  type ConclaveMeta,
  type RunWithMeta,
  type StatusFilter,
  type TriggerFilter,
} from "./list";
import { RunDetail } from "./detail";

type ArtifactInfo = { filename: string; path: string; size: number; createdAt: string };

export function RunsPage() {
  const initialId = parseRunIdFromUrl();
  const [runs, setRuns] = useState<RunWithMeta[]>([]);
  const [conclaves, setConclaves] = useState<Map<string, ConclaveMeta>>(new Map());
  const [selectedId, setSelectedId] = useState<number | null>(initialId);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(new Map());
  const [nodeTypes, setNodeTypes] = useState<Map<string, string>>(new Map());
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [artifactsDir, setArtifactsDir] = useState("");
  const [chatUrl, setChatUrl] = useState<string | null>(null);
  const labelsLoadedFor = useRef<number | null>(null);

  const loadRuns = () => {
    api.get<{ runs: RunWithMeta[] }>("/runs").then((d) => setRuns(d.runs)).catch(() => {});
  };

  useEffect(() => {
    loadRuns();
    api
      .get<{ conclaves: Array<{ id: number; name: string; definition?: Record<string, unknown> }> }>("/conclaves")
      .then((d) => {
        const map = new Map<string, ConclaveMeta>();
        for (const w of d.conclaves) {
          const def = w.definition ?? {};
          const nodes = (def.nodes ?? []) as Array<{ data?: { type?: string; config?: Record<string, unknown> } }>;
          const triggerNode = nodes.find((n) => n.data?.type === "trigger");
          const triggerType = triggerNode?.data?.config?.type as string | undefined;
          map.set(String(w.id), {
            name: w.name,
            toolName: def.toolName as string | undefined,
            triggerType,
          });
        }
        setConclaves(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const hasLive = runs.some((r) => r.status === "running" || r.status === "queued");
    const interval = setInterval(loadRuns, hasLive ? 2000 : 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, runs]);

  useEffect(() => {
    const target = selectedId ? `/runs/${selectedId}` : "/runs";
    if (window.location.pathname !== target) {
      window.history.replaceState({}, "", target);
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      setArtifacts([]);
      setChatUrl(null);
      return;
    }

    const loadDetail = () => {
      api.get<RunDetailResponse>(`/runs/${selectedId}`)
        .then((d) => setDetail(d))
        .catch(() => {});
    };

    const loadArtifacts = () => {
      api
        .get<{ data: { artifacts: ArtifactInfo[]; dir: string } }>(`/runs/${selectedId}/artifacts`)
        .then((res) => {
          setArtifacts(res.data?.artifacts ?? []);
          setArtifactsDir(res.data?.dir ?? "");
        })
        .catch(() => {});
    };

    loadDetail();
    loadArtifacts();

    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (detail?.run.status === "running" || detail?.run.status === "queued" || !detail) {
        loadDetail();
        loadArtifacts();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedId, autoRefresh, detail?.run.status]);

  useEffect(() => {
    const conclaveId = detail?.run.conclaveId;
    if (!conclaveId || labelsLoadedFor.current === conclaveId) return;
    labelsLoadedFor.current = conclaveId;

    api
      .get<{ definition?: { nodes?: Array<{ id: string; data?: { label?: string; type?: string; config?: Record<string, unknown> } }>; toolName?: string } }>(`/conclaves/${conclaveId}`)
      .then((wf) => {
        const def = ((wf as Record<string, unknown>).definition ?? wf) as Record<string, unknown>;
        const nodes = (def.nodes as Array<{ id: string; data?: { label?: string; type?: string; config?: Record<string, unknown> } }>) ?? [];
        const labels = new Map<string, string>();
        const types = new Map<string, string>();
        for (const n of nodes) {
          labels.set(n.id, n.data?.label ?? n.id);
          if (n.data?.type) types.set(n.id, n.data.type);
        }
        setNodeLabels(labels);
        setNodeTypes(types);

        const triggerNode = nodes.find((n) => n.data?.type === "trigger");
        const triggerType = triggerNode?.data?.config?.type as string | undefined;
        const toolName = def.toolName as string | undefined;
        if (triggerType === "chat" && toolName && selectedId) {
          setChatUrl(`/${toolName}/chat/${selectedId}`);
        } else {
          setChatUrl(null);
        }
      })
      .catch(() => {});
  }, [detail?.run.conclaveId, selectedId]);

  const filtered = useMemo(
    () => filterRuns(runs, query, statusFilter, triggerFilter, conclaves),
    [runs, query, statusFilter, triggerFilter, conclaves],
  );

  const selectedMeta = selectedId != null && detail
    ? conclaves.get(String(detail.run.conclaveId))
    : undefined;

  const refreshDetail = () => {
    if (selectedId != null) {
      api.get<RunDetailResponse>(`/runs/${selectedId}`).then(setDetail).catch(() => {});
    }
    loadRuns();
  };

  return (
    <div className="runs-shell">
      <RunsHeader
        filteredCount={filtered.length}
        totalCount={runs.length}
        query={query}
        setQuery={setQuery}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
      />
      <RunsFilters
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        triggerFilter={triggerFilter}
        setTriggerFilter={setTriggerFilter}
        runs={runs}
      />
      <div className="runs-body split">
        <RunsList
          runs={filtered}
          conclaves={conclaves}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {detail ? (
          <RunDetail
            data={detail}
            conclaveMeta={selectedMeta}
            nodeLabels={nodeLabels}
            nodeTypes={nodeTypes}
            artifacts={artifacts}
            artifactsDir={artifactsDir}
            chatUrl={chatUrl}
            onRefresh={refreshDetail}
          />
        ) : (
          <div className="runs-detail">
            <div className="detail-empty">
              {selectedId != null ? "Loading…" : "Select a run from the list."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseRunIdFromUrl(): number | null {
  const m = window.location.pathname.match(/^\/runs\/(\d+)/);
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
