import { useState, useEffect, useRef, useCallback } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { X, Trash2, Sparkles, Loader2 } from "lucide-react";
import type {
  WorkflowNodeData,
  AgentConfig,
  TriggerConfig,
  ConditionConfig,
  CodeConfig,
  PromptConfig,
  OutputConfig,
  DiscussionConfig,
} from "@openconclave/shared";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Field, INPUT_CLASS, AutoTextarea } from "./inspector/shared";
import { TriggerFields } from "./inspector/trigger-fields";
import { AgentFields } from "./inspector/agent-fields";
import { ConditionFields } from "./inspector/condition-fields";
import { CodeFields } from "./inspector/code-fields";
import { OutputFields, PromptFields } from "./inspector/output-fields";
import { FileFields } from "./inspector/file-fields";
import { DiscussionFields } from "./inspector/discussion-fields";

// ── Workflow-level settings (shown when no node selected) ────

function WorkflowSettings() {
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const setWorkflowMeta = useWorkflowStore((s) => s.setWorkflowMeta);
  const toolName = useWorkflowStore((s) => s.toolName);
  const workflowId = window.location.pathname.match(/\/workflows\/(\d+)/)?.[1];

  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const [improving, setImproving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get<{ installed: boolean }>("/claude-code/status")
      .then((d) => setClaudeAvailable(d.installed))
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const handleImprove = useCallback(async () => {
    if (!workflowId || improving) return;
    const sent = workflowDescription;
    setImproving(true);

    try {
      await api.post("/channel/improve-description", {
        workflowId: String(workflowId),
        currentDescription: sent,
      });
      toast("Sent to Claude Code — waiting for improved instructions...");
    } catch {
      toast("Failed to send to Claude Code", "error");
      setImproving(false);
      return;
    }

    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 3000;
      if (elapsed > 60000) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setImproving(false);
        toast("Timed out waiting for Claude to update the instructions", "error");
        return;
      }
      try {
        const wf = await api.get<Record<string, unknown>>(`/workflows/${workflowId}`);
        const dbDesc = (wf.description as string) ?? "";
        if (dbDesc && dbDesc !== sent) {
          setWorkflowMeta(workflowName, dbDesc);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setImproving(false);
          toast("Instructions improved by Claude");
        }
      } catch { /* ignore poll errors */ }
    }, 3000);
  }, [workflowId, workflowDescription, workflowName, improving, setWorkflowMeta]);

  return (
    <div className="w-72 border-l border-border bg-card overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Workflow Settings</h3>
      </div>

      <div className="space-y-4 p-4">
        <Field label="Name">
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowMeta(e.target.value, workflowDescription)}
            className={INPUT_CLASS}
            placeholder="Workflow name..."
          />
        </Field>

        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            Instructions for Claude
          </label>
          <AutoTextarea
            value={workflowDescription}
            onChange={(e) => setWorkflowMeta(workflowName, e.target.value)}
            minRows={6}
            label="Instructions for Claude"
            className={INPUT_CLASS}
            placeholder="Describe the workflow's purpose, context, and any rules Claude should follow when executing this workflow..."
          />
        </div>
        <div className="flex items-center gap-2 px-1">
          <p className="text-[10px] text-muted-foreground flex-1">
            Instructions help Claude understand the workflow's purpose and constraints.
            Be specific about the expected behavior, tone, and any rules to follow.
          </p>
          {claudeAvailable && workflowId && (
            <button
              onClick={handleImprove}
              disabled={improving}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors shrink-0",
                improving
                  ? "text-muted-foreground cursor-wait"
                  : "text-primary hover:bg-primary/10"
              )}
              title="Ask Claude Code to improve these instructions"
            >
              {improving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {improving ? "Improving..." : "Improve"}
            </button>
          )}
        </div>

        {toolName && (
          <Field label="Tool Name">
            <input
              type="text"
              value={toolName}
              onChange={(e) => useWorkflowStore.setState({ toolName: e.target.value || undefined, isDirty: true })}
              className={`${INPUT_CLASS} font-mono text-xs`}
              placeholder="my_workflow_tool"
            />
          </Field>
        )}
      </div>
    </div>
  );
}

// ── Node inspector ───────────────────────────────────────────

export function NodeInspector() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const removeNode = useWorkflowStore((s) => s.removeNode);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) return <WorkflowSettings />;

  const data = selectedNode.data as WorkflowNodeData;

  return (
    <div className="w-72 border-l border-border bg-card overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Properties</h3>
        <button
          onClick={() => setSelectedNode(null)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <Field label="Label">
          <input
            type="text"
            value={data.label}
            onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <div className="text-xs text-muted-foreground uppercase tracking-wider">
          {data.type === "prompt" ? "channel loop" : data.type} config
        </div>

        {data.type === "trigger" && (
          <TriggerFields nodeId={selectedNode.id} config={data.config as TriggerConfig} />
        )}
        {data.type === "agent" && (
          <AgentFields nodeId={selectedNode.id} config={data.config as AgentConfig} />
        )}
        {data.type === "condition" && (
          <ConditionFields nodeId={selectedNode.id} config={data.config as ConditionConfig} />
        )}
        {data.type === "code" && (
          <CodeFields nodeId={selectedNode.id} config={data.config as CodeConfig} />
        )}
        {data.type === "prompt" && (
          <PromptFields nodeId={selectedNode.id} config={data.config as PromptConfig} />
        )}
        {data.type === "merge" && (
          <p className="text-xs text-muted-foreground">
            Waits for all connected inputs to complete, then combines them into a single object
            using each source node's label as the key.
          </p>
        )}
        {data.type === "output" && (
          <OutputFields nodeId={selectedNode.id} config={data.config as OutputConfig} />
        )}
        {data.type === "file" && (
          <FileFields nodeId={selectedNode.id} config={data.config as { path: string }} />
        )}
        {data.type === "discussion" && (
          <DiscussionFields nodeId={selectedNode.id} config={data.config as DiscussionConfig} />
        )}

        <button
          onClick={() => removeNode(selectedNode.id)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors mt-6"
        >
          <Trash2 className="h-4 w-4" />
          Delete Node
        </button>
      </div>
    </div>
  );
}
