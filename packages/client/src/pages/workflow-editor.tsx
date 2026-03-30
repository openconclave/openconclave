import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { NodePalette } from "@/components/editor/node-palette";
import { WorkflowCanvas } from "@/components/editor/workflow-canvas";
import { NodeInspector } from "@/components/editor/node-inspector";
import { useWorkflowStore, edgeStyle } from "@/stores/workflow-store";
import { api } from "@/lib/api";
import { Save, Play, Square } from "lucide-react";
import { toast } from "@/components/ui/toast";

function toSnakeCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function WorkflowEditorPage() {
  const { nodes, edges, workflowName, workflowDescription, isDirty, setWorkflowMeta, loadWorkflow, reset } =
    useWorkflowStore();
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const setActiveNode = useWorkflowStore((s) => s.setActiveNode);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const path = window.location.pathname;
  const existingId = path.startsWith("/workflows/") ? path.split("/")[2] : null;
  const isNew = !existingId || existingId === "new";

  // Load existing workflow on mount
  useEffect(() => {
    if (isNew) {
      reset();
      setLoaded(true);
      return;
    }

    api
      .get<any>(`/workflows/${existingId}`)
      .then((wf) => {
        const def = wf.definition ?? wf;
        loadWorkflow(
          (def.nodes ?? []).map((n: any) => ({
            id: n.id,
            type: n.type ?? n.data?.type,
            position: n.position,
            data: n.data,
          })),
          (def.edges ?? []).map((e: any) => {
            const { style, markerEnd } = edgeStyle(e.sourceHandle);
            return { ...e, type: "default", animated: false, style, markerEnd };
          }),
          def.name ?? wf.name ?? "Untitled Workflow",
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

  // Poll for active runs on this workflow
  useEffect(() => {
    if (isNew) return;
    const check = () => {
      api
        .get<{ runs: any[] }>("/runs")
        .then((d) => {
          const active = d.runs.find(
            (r: any) => r.workflowId === existingId && (r.status === "running" || r.status === "queued")
          );
          setActiveRunId(active?.id ?? null);
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, [existingId]);

  // Poll for active node when a run is in progress
  useEffect(() => {
    if (!activeRunId) {
      setActiveNode(null);
      return;
    }
    const check = () => {
      api
        .get<{ run: any; tasks: any[]; events: any[] }>(`/runs/${activeRunId}`)
        .then((d) => {
          if (d.run.status !== "running") {
            setActiveRunId(null);
            setActiveNode(null);
            return;
          }
          // Find last node:started that doesn't have a node:completed after it
          const started = new Set<string>();
          const completed = new Set<string>();
          for (const e of d.events) {
            if (e.type === "node:started" && e.nodeId) started.add(e.nodeId);
            if (e.type === "node:completed" && e.nodeId) completed.add(e.nodeId);
          }
          // The active node is the last started that isn't completed
          // But nodes can be revisited in loops, so check the last event
          let current: string | null = null;
          for (let i = d.events.length - 1; i >= 0; i--) {
            const e = d.events[i];
            if (e.type === "node:started" && e.nodeId) {
              current = e.nodeId;
              break;
            }
          }
          // If the last started node also has a completed after it, it's done
          if (current) {
            const lastStartIdx = d.events.findLastIndex(
              (e: any) => e.type === "node:started" && e.nodeId === current
            );
            const lastCompleteIdx = d.events.findLastIndex(
              (e: any) => e.type === "node:completed" && e.nodeId === current
            );
            if (lastCompleteIdx > lastStartIdx) current = null;
          }
          setActiveNode(current);
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, [activeRunId]);

  const handleSave = async () => {
    // Check for duplicate labels and auto-fix
    const labelCount = new Map<string, number>();
    for (const n of nodes) {
      const count = (labelCount.get(n.data.label) ?? 0) + 1;
      labelCount.set(n.data.label, count);
    }
    const hasDuplicates = [...labelCount.values()].some((c) => c > 1);
    if (hasDuplicates) {
      // Auto-fix: append numbers to duplicates
      const seen = new Map<string, number>();
      for (const n of nodes) {
        const count = labelCount.get(n.data.label) ?? 1;
        if (count > 1) {
          const idx = (seen.get(n.data.label) ?? 0) + 1;
          seen.set(n.data.label, idx);
          useWorkflowStore.getState().updateNodeData(n.id, { label: `${n.data.label} ${idx}` });
        }
      }
      toast("Duplicate node labels renamed automatically", "success");
    }

    setSaving(true);
    try {
      // Re-read nodes after potential rename
      const currentNodes = useWorkflowStore.getState().nodes;
      // Auto-generate tool_name if missing
      const currentToolName = useWorkflowStore.getState().toolName || toSnakeCase(workflowName);
      if (currentToolName) {
        useWorkflowStore.setState({ toolName: currentToolName });
      }

      // Check uniqueness of name and toolName
      const allWorkflows = await api.get<{ workflows: Array<{ id: string; name: string; definition: any }> }>("/workflows");
      const others = allWorkflows.workflows.filter((w) => w.id !== existingId);
      const nameTaken = others.some((w) => w.name === workflowName);
      if (nameTaken) {
        toast(`Workflow name "${workflowName}" is already taken`, "error");
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
        name: workflowName,
        description: workflowDescription,
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
        await api.put(`/workflows/${existingId}`, payload);
      } else {
        const result = await api.post<{ id: string }>("/workflows", payload);
        window.history.replaceState(null, "", `/workflows/${result.id}`);
      }

      useWorkflowStore.setState({ isDirty: false });
      toast("Saved. Run /mcp in Claude Code to refresh tools.", "success");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (isNew) return;
    try {
      const result = await api.post<{ runId: string }>(`/workflows/${existingId}/run`, {});
      setActiveRunId(result.runId);
      toast(`Workflow run started: ${result.runId.slice(0, 8)}...`, "success");
    } catch (err: any) {
      toast(`Failed to start run: ${err.message}`, "error");
    }
  };

  const handleStop = async () => {
    if (!activeRunId) return;
    try {
      await api.post(`/runs/${activeRunId}/cancel`, {});
      setActiveRunId(null);
      toast("Workflow run cancelled", "success");
    } catch (err: any) {
      toast(`Failed to cancel: ${err.message}`, "error");
    }
  };

  if (!loaded) {
    return (
      <>
        <Header title="Loading..." />
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Loading workflow...
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title={
          <div className="flex flex-col gap-0.5">
            <input
              type="text"
              value={workflowName}
              onChange={(e) => {
                setWorkflowMeta(e.target.value, workflowDescription);
                // Auto-generate tool_name from workflow name if not manually set
                const current = useWorkflowStore.getState().toolName;
                if (!current || current === toSnakeCase(workflowName)) {
                  useWorkflowStore.setState({ toolName: toSnakeCase(e.target.value) || undefined });
                }
              }}
              className="bg-transparent text-lg font-semibold border-none outline-none focus:ring-0 w-80"
              placeholder="Workflow name..."
            />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground/50">
                {useWorkflowStore.getState().toolName || toSnakeCase(workflowName) || "tool_name"}
              </span>
              <span className="text-[10px] text-muted-foreground/30">·</span>
              <input
                type="text"
                value={workflowDescription}
                onChange={(e) => setWorkflowMeta(workflowName, e.target.value)}
                className="bg-transparent text-[11px] text-muted-foreground border-none outline-none focus:ring-0 flex-1 min-w-0"
                placeholder="Description for Claude..."
              />
            </div>
          </div>
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
                  <Play className="h-4 w-4" />
                  Run
                </button>
              )
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
        <WorkflowCanvas />
        <NodeInspector />
      </div>
    </>
  );
}
