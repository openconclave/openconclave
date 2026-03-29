import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { NodePalette } from "@/components/editor/node-palette";
import { WorkflowCanvas } from "@/components/editor/workflow-canvas";
import { NodeInspector } from "@/components/editor/node-inspector";
import { useWorkflowStore } from "@/stores/workflow-store";
import { api } from "@/lib/api";
import { Save, Play } from "lucide-react";
import { toast } from "@/components/ui/toast";

export function WorkflowEditorPage() {
  const { nodes, edges, workflowName, workflowDescription, isDirty, setWorkflowMeta, loadWorkflow, reset } =
    useWorkflowStore();
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
          def.edges ?? [],
          def.name ?? wf.name ?? "Untitled Workflow",
          def.description ?? wf.description ?? ""
        );
        setLoaded(true);
      })
      .catch(() => {
        reset();
        setLoaded(true);
      });
  }, [existingId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: workflowName,
        description: workflowDescription,
        nodes: nodes.map((n) => ({
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
          label: (e as any).label,
        })),
      };

      if (!isNew) {
        await api.put(`/workflows/${existingId}`, payload);
      } else {
        const result = await api.post<{ id: string }>("/workflows", payload);
        window.history.replaceState(null, "", `/workflows/${result.id}`);
      }

      useWorkflowStore.setState({ isDirty: false });
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (isNew) return;
    try {
      const result = await api.post<{ runId: string }>(`/workflows/${existingId}/run`, {});
      toast(`Workflow run started: ${result.runId.slice(0, 8)}...`, "success");
    } catch (err: any) {
      toast(`Failed to start run: ${err.message}`, "error");
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
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowMeta(e.target.value, workflowDescription)}
            className="bg-transparent text-lg font-semibold border-none outline-none focus:ring-0 w-64"
            placeholder="Workflow name..."
          />
        }
        actions={
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                onClick={handleRun}
                className="inline-flex items-center gap-2 rounded-md bg-success px-3 py-1.5 text-sm font-medium text-white hover:bg-success/90 transition-colors"
              >
                <Play className="h-4 w-4" />
                Run
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
        <WorkflowCanvas />
        <NodeInspector />
      </div>
    </>
  );
}
