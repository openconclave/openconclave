import { useState, useEffect, useRef, useCallback } from "react";
import { useConclaveStore } from "@/stores/conclave-store";
import { X, Trash2, Sparkles, Loader2 } from "lucide-react";
import type {
  ConclaveNodeData,
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

// ── Conclave-level settings (shown when no node selected) ────

function ConclaveSettings() {
  const conclaveName = useConclaveStore((s) => s.conclaveName);
  const conclaveDescription = useConclaveStore((s) => s.conclaveDescription);
  const setConclaveMeta = useConclaveStore((s) => s.setConclaveMeta);
  const toolName = useConclaveStore((s) => s.toolName);
  const conclaveId = window.location.pathname.match(/\/conclaves\/(\d+)/)?.[1];

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
    if (!conclaveId || improving) return;
    const sent = conclaveDescription;
    setImproving(true);

    try {
      await api.post("/channel/improve-description", {
        conclaveId: String(conclaveId),
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
        const wf = await api.get<Record<string, unknown>>(`/conclaves/${conclaveId}`);
        const dbDesc = (wf.description as string) ?? "";
        if (dbDesc && dbDesc !== sent) {
          setConclaveMeta(conclaveName, dbDesc);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setImproving(false);
          toast("Instructions improved by Claude");
        }
      } catch { /* ignore poll errors */ }
    }, 3000);
  }, [conclaveId, conclaveDescription, conclaveName, improving, setConclaveMeta]);

  return (
    <div className="w-72 border-l border-border bg-card overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Conclave Settings</h3>
      </div>

      <div className="space-y-4 p-4">
        <Field label="Name">
          <input
            type="text"
            value={conclaveName}
            onChange={(e) => setConclaveMeta(e.target.value, conclaveDescription)}
            className={INPUT_CLASS}
            placeholder="Conclave name..."
          />
        </Field>

        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            Instructions for Claude
          </label>
          <AutoTextarea
            value={conclaveDescription}
            onChange={(e) => setConclaveMeta(conclaveName, e.target.value)}
            minRows={6}
            label="Instructions for Claude"
            className={INPUT_CLASS}
            placeholder="Describe the conclave's purpose, context, and any rules Claude should follow when executing this conclave..."
          />
        </div>
        <div className="flex items-center gap-2 px-1">
          <p className="text-[10px] text-muted-foreground flex-1">
            Instructions help Claude understand the conclave's purpose and constraints.
            Be specific about the expected behavior, tone, and any rules to follow.
          </p>
          {claudeAvailable && conclaveId && (
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

        <Field label="Tool Name">
          <input
            type="text"
            value={toolName ?? ""}
            onChange={(e) => useConclaveStore.setState({ toolName: e.target.value || undefined, isDirty: true })}
            className={`${INPUT_CLASS} font-mono text-xs`}
            placeholder="my_conclave_tool"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Set this to expose the conclave as an MCP tool in the channel plugin (e.g. <code>simple_chat</code>).
          </p>
        </Field>
      </div>
    </div>
  );
}

// ── Node inspector ───────────────────────────────────────────

export function NodeInspector() {
  const nodes = useConclaveStore((s) => s.nodes);
  const selectedNodeId = useConclaveStore((s) => s.selectedNodeId);
  const setSelectedNode = useConclaveStore((s) => s.setSelectedNode);
  const updateNodeData = useConclaveStore((s) => s.updateNodeData);
  const removeNode = useConclaveStore((s) => s.removeNode);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) return <ConclaveSettings />;

  const data = selectedNode.data as ConclaveNodeData;

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
