import { useEffect, useRef, useState, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { NodePalette } from "@/components/editor/node-palette";
import { ConclaveCanvas } from "@/components/editor/conclave-canvas";
import { NodeInspector } from "@/components/editor/node-inspector";
import { useConclaveStore } from "@/stores/conclave-store";
import { api } from "@/lib/api";
import { wsClient } from "@/lib/ws";
import { Save, Play, Square, MessageSquare, Download } from "lucide-react";
import { toast } from "@/components/ui/toast";

function toSnakeCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function ConclaveEditorPage() {
  const nodes = useConclaveStore((s) => s.nodes);
  const edges = useConclaveStore((s) => s.edges);
  const conclaveName = useConclaveStore((s) => s.conclaveName);
  const conclaveDescription = useConclaveStore((s) => s.conclaveDescription);
  const isDirty = useConclaveStore((s) => s.isDirty);
  const setConclaveMeta = useConclaveStore((s) => s.setConclaveMeta);
  const loadConclave = useConclaveStore((s) => s.loadConclave);
  const reset = useConclaveStore((s) => s.reset);
  const setActiveNodes = useConclaveStore((s) => s.setActiveNodes);
  const setSkippedNodes = useConclaveStore((s) => s.setSkippedNodes);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const path = window.location.pathname;
  const existingId = path.startsWith("/conclaves/") ? path.split("/")[2] : null;
  const isNew = !existingId || existingId === "new";

  // Load existing conclave on mount
  useEffect(() => {
    if (isNew) {
      reset();
      setLoaded(true);
      return;
    }

    api
      .get<any>(`/conclaves/${existingId}`)
      .then((wf) => {
        const def = wf.definition ?? wf;
        loadConclave(
          (def.nodes ?? []).map((n: any) => ({
            id: n.id,
            type: n.type ?? n.data?.type,
            position: n.position,
            data: n.data,
          })),
          (def.edges ?? []).map((e: any) => ({
            ...e,
            animated: false,
            targetHandle: e.targetHandle ?? "top",
          })),
          def.name ?? wf.name ?? "Untitled Conclave",
          def.description ?? wf.description ?? "",
          def.toolName ?? wf.toolName
        );
        setLoaded(true);
      })
      .catch(() => {
        reset();
        setLoaded(true);
      });
  }, [existingId]);

  // Poll for active runs on this conclave
  useEffect(() => {
    if (isNew) return;
    const check = () => {
      api
        .get<{ runs: any[] }>("/runs")
        .then((d) => {
          const active = d.runs.find(
            (r: any) => String(r.conclaveId) === existingId && (r.status === "running" || r.status === "queued")
          );
          setActiveRunId(active?.id ?? null);
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, [existingId]);

  // Track active and skipped nodes when a run is in progress (poll + WebSocket)
  const activeRef = useRef(new Set<string>());
  const skippedRef = useRef(new Set<string>());

  const refreshActiveNodes = useCallback(() => {
    if (!activeRunId) return;
    api
      .get<{ run: any; tasks: any[]; events: any[] }>(`/runs/${activeRunId}`)
      .then((d) => {
        if (d.run.status !== "running" && d.run.status !== "queued") {
          setActiveRunId(null);
          setActiveNodes(new Set());
          activeRef.current = new Set();
          setSkippedNodes(new Set());
          skippedRef.current = new Set();
          return;
        }
        const active = new Set<string>();
        const skipped = new Set<string>();
        for (const e of d.events) {
          if ((e.type === "node:started" || e.type === "agent:started") && e.nodeId) active.add(e.nodeId);
          if ((e.type === "node:completed" || e.type === "agent:completed") && e.nodeId) active.delete(e.nodeId);
          if (e.type === "node:skipped" && e.nodeId) { active.delete(e.nodeId); skipped.add(e.nodeId); }
        }
        activeRef.current = active;
        setActiveNodes(new Set(active));
        skippedRef.current = skipped;
        setSkippedNodes(new Set(skipped));
      })
      .catch(() => {});
  }, [activeRunId]);

  useEffect(() => {
    if (!activeRunId) {
      setActiveNodes(new Set());
      activeRef.current = new Set();
      setSkippedNodes(new Set());
      skippedRef.current = new Set();
      return;
    }

    const topic = `run:${activeRunId}`;
    wsClient.subscribe([topic]);

    // Buffer mutations in the refs; flush to the store once per animation
    // frame. At 5-10 agent events/sec this collapses N store writes per frame
    // into one, capping per-node selector re-evaluation at 60 Hz regardless
    // of WS event rate.
    let rafId: number | null = null;
    let activeDirty = false;
    let skippedDirty = false;
    const flush = () => {
      rafId = null;
      if (activeDirty) {
        activeDirty = false;
        setActiveNodes(new Set(activeRef.current));
      }
      if (skippedDirty) {
        skippedDirty = false;
        setSkippedNodes(new Set(skippedRef.current));
      }
    };
    const schedule = () => {
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    const off = wsClient.on("*", (data: any) => {
      if (!data?.nodeId || String(data.runId) !== String(activeRunId)) return;
      if (data.type === "node:started" || data.type === "agent:started") {
        activeRef.current.add(data.nodeId);
        activeDirty = true;
      } else if (data.type === "node:completed" || data.type === "agent:completed") {
        activeRef.current.delete(data.nodeId);
        activeDirty = true;
      } else if (data.type === "node:skipped") {
        activeRef.current.delete(data.nodeId);
        skippedRef.current.add(data.nodeId);
        activeDirty = true;
        skippedDirty = true;
      } else {
        return;
      }
      schedule();
    });

    // Bootstrap once so we catch events that fired before we subscribed.
    // After that, WebSocket is the single source of truth.
    refreshActiveNodes();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      wsClient.unsubscribe([topic]);
      off();
    };
  }, [activeRunId, refreshActiveNodes]);

  const handleSave = async () => {
    // Check for duplicate labels and auto-fix
    const labelCount = new Map<string, number>();
    for (const n of nodes) {
      const count = (labelCount.get(n.data.label) ?? 0) + 1;
      labelCount.set(n.data.label, count);
    }
    const hasDuplicates = [...labelCount.values()].some((c) => c > 1);
    // Snapshot original labels so we can revert if save fails
    const originalLabels = hasDuplicates
      ? new Map(nodes.map((n) => [n.id, n.data.label]))
      : null;
    if (hasDuplicates) {
      // Auto-fix: append numbers to duplicates
      const seen = new Map<string, number>();
      for (const n of nodes) {
        const count = labelCount.get(n.data.label) ?? 1;
        if (count > 1) {
          const idx = (seen.get(n.data.label) ?? 0) + 1;
          seen.set(n.data.label, idx);
          useConclaveStore.getState().updateNodeData(n.id, { label: `${n.data.label} ${idx}` });
        }
      }
      toast("Duplicate node labels renamed automatically", "success");
    }

    setSaving(true);
    let saved = false;
    try {
      // Re-read nodes after potential rename
      const currentNodes = useConclaveStore.getState().nodes;
      // Auto-generate tool_name if missing
      const currentToolName = useConclaveStore.getState().toolName || toSnakeCase(conclaveName);
      if (currentToolName) {
        useConclaveStore.setState({ toolName: currentToolName });
      }

      // Check uniqueness of name and toolName
      const allConclaves = await api.get<{ conclaves: Array<{ id: string; name: string; definition: any }> }>("/conclaves");
      const others = allConclaves.conclaves.filter((w) => String(w.id) !== existingId);
      const nameTaken = others.some((w) => w.name === conclaveName);
      if (nameTaken) {
        toast(`Conclave name "${conclaveName}" is already taken`, "error");
        setSaving(false);
        return;
      }
      const toolTaken = others.some((w) => {
        const def = w.definition ?? {};
        return def.toolName === currentToolName;
      });
      if (toolTaken) {
        toast(`Tool name "${currentToolName}" is already taken`, "error");
        setSaving(false);
        return;
      }

      const payload = {
        name: conclaveName,
        description: conclaveDescription,
        toolName: currentToolName || undefined,
        nodes: currentNodes.map((n) => ({
          id: n.id,
          type: n.data.type,
          position: n.position,
          data: n.data,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          label: "label" in e ? String(e.label) : undefined,
        })),
      };

      if (!isNew) {
        await api.put(`/conclaves/${existingId}`, payload);
      } else {
        const result = await api.post<{ id: string }>("/conclaves", payload);
        window.history.replaceState(null, "", `/conclaves/${result.id}`);
      }

      useConclaveStore.setState({ isDirty: false });
      saved = true;
      toast("Saved. Run /mcp in Claude Code to refresh tools.", "success");
    } finally {
      if (!saved && originalLabels) {
        // Revert the auto-rename so the user doesn't see phantom labels
        for (const [id, label] of originalLabels) {
          useConclaveStore.getState().updateNodeData(id, { label });
        }
      }
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (isNew) return;
    // If trigger is "chat", open the chat page instead
    const triggerNode = nodes.find((n) => n.data?.type === "trigger");
    const triggerConfig = triggerNode?.data?.config as Record<string, unknown> | undefined;
    if (triggerConfig?.type === "chat") {
      const toolName = useConclaveStore.getState().toolName;
      if (toolName) {
        window.open(`/${toolName}/chat`, "_blank");
        return;
      }
      toast("Set a tool name first (in conclave settings) to use chat", "error");
      return;
    }
    try {
      const result = await api.post<{ runId: string }>(`/conclaves/${existingId}/run`, {});
      setActiveRunId(result.runId);
      toast(`Conclave run started: #${result.runId}`, "success");
    } catch (err: any) {
      toast(`Failed to start run: ${err.message}`, "error");
    }
  };

  const handleStop = async () => {
    if (!activeRunId) return;
    try {
      await api.post(`/runs/${activeRunId}/cancel`, {});
      setActiveRunId(null);
      toast("Conclave run cancelled", "success");
    } catch (err: any) {
      toast(`Failed to cancel: ${err.message}`, "error");
    }
  };

  if (!loaded) {
    return (
      <>
        <Header title="Loading..." />
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Loading conclave...
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        breadcrumb={[{ label: "Conclaves", href: "/conclaves" }]}
        title={
          <input
            type="text"
            value={conclaveName}
            onChange={(e) => {
              setConclaveMeta(e.target.value, conclaveDescription);
              const current = useConclaveStore.getState().toolName;
              if (!current || current === toSnakeCase(conclaveName)) {
                useConclaveStore.setState({ toolName: toSnakeCase(e.target.value) || undefined });
              }
            }}
            className="bg-transparent text-lg font-semibold border-none outline-none focus:ring-0 w-80"
            placeholder="Conclave name..."
            aria-label="Conclave name"
          />
        }
        actions={
          <div className="flex items-center gap-2">
            {!isNew && (
              activeRunId ? (
                <button
                  onClick={handleStop}
                  className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90 transition-colors"
                >
                  <Square className="h-4 w-4" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleRun}
                  className="inline-flex items-center gap-2 rounded-md bg-success px-3 py-1.5 text-sm font-medium text-white hover:bg-success/90 transition-colors"
                >
                  {(() => {
                    const tn = nodes.find((n) => n.data?.type === "trigger");
                    const tc = tn?.data?.config as Record<string, unknown> | undefined;
                    return tc?.type === "chat"
                      ? <><MessageSquare className="h-4 w-4" /> Chat</>
                      : <><Play className="h-4 w-4" /> Run</>;
                  })()}
                </button>
              )
            )}
            {!isNew && (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/conclaves/${existingId}/export`);
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
                    setTimeout(() => URL.revokeObjectURL(url), 0);
                    toast("Exported", "success");
                  } catch (err) {
                    toast(`Export failed: ${(err as Error).message}`, "error");
                  }
                }}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                title="Export conclave"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />
        <ConclaveCanvas />
        <NodeInspector />
      </div>
    </>
  );
}
