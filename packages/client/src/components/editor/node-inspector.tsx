import { useWorkflowStore } from "@/stores/workflow-store";
import { X, Trash2 } from "lucide-react";
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
import { Field, INPUT_CLASS } from "./inspector/shared";
import { TriggerFields } from "./inspector/trigger-fields";
import { AgentFields } from "./inspector/agent-fields";
import { ConditionFields } from "./inspector/condition-fields";
import { CodeFields } from "./inspector/code-fields";
import { OutputFields, PromptFields } from "./inspector/output-fields";
import { FileFields } from "./inspector/file-fields";
import { DiscussionFields } from "./inspector/discussion-fields";

export function NodeInspector() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const removeNode = useWorkflowStore((s) => s.removeNode);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) return null;

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
        {data.type === "transform" && (
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
