import { useState, useEffect } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { X, Trash2 } from "lucide-react";
import { ToolPicker } from "./tool-picker";
import type { WorkflowNodeData, AgentConfig, TriggerConfig, ConditionConfig, TransformConfig, OutputConfig } from "@openconclave/shared";

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
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </Field>

        <div className="text-xs text-muted-foreground uppercase tracking-wider">
          {data.type} config
        </div>

        {data.type === "trigger" && <TriggerFields nodeId={selectedNode.id} config={data.config as TriggerConfig} />}
        {data.type === "agent" && <AgentFields nodeId={selectedNode.id} config={data.config as AgentConfig} />}
        {data.type === "condition" && <ExpressionField nodeId={selectedNode.id} config={data.config as ConditionConfig} />}
        {data.type === "transform" && <CodeFields nodeId={selectedNode.id} config={data.config as TransformConfig} />}
        {data.type === "output" && <OutputFields nodeId={selectedNode.id} config={data.config as OutputConfig} />}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function TriggerFields({ nodeId, config }: { nodeId: string; config: TriggerConfig }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const update = (c: Partial<TriggerConfig>) =>
    updateNodeData(nodeId, { config: { ...config, ...c } } as any);

  return (
    <>
      <Field label="Type">
        <select
          value={config.type}
          onChange={(e) => update({ type: e.target.value as TriggerConfig["type"] })}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <option value="manual">Manual</option>
          <option value="cron">Cron</option>
          <option value="webhook">Webhook</option>
          <option value="channel">Channel (Claude Code)</option>
        </select>
      </Field>
      {config.type === "cron" && (
        <Field label="Cron Expression">
          <input
            type="text"
            value={config.cron ?? ""}
            onChange={(e) => update({ cron: e.target.value })}
            placeholder="0 9 * * 1-5"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
          />
        </Field>
      )}
      {config.type === "webhook" && (
        <Field label="Webhook Path">
          <input
            type="text"
            value={config.webhookPath ?? ""}
            onChange={(e) => update({ webhookPath: e.target.value })}
            placeholder="/hooks/my-trigger"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
          />
        </Field>
      )}
      {config.type === "channel" && (
        <p className="text-[10px] text-muted-foreground px-1">
          Triggered from Claude Code via the OpenConclave channel. The payload passed becomes the input.
        </p>
      )}
      {(config.type === "manual" || config.type === "cron") && (
        <Field label="Input Prompt">
          <textarea
            value={config.prompt ?? ""}
            onChange={(e) => update({ prompt: e.target.value })}
            placeholder="Initial data passed to the first node..."
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm resize-none"
          />
        </Field>
      )}
    </>
  );
}

function AgentFields({ nodeId, config }: { nodeId: string; config: AgentConfig }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const update = (c: Partial<AgentConfig>) =>
    updateNodeData(nodeId, { config: { ...config, ...c } } as any);

  const [ollamaStatus, setOllamaStatus] = useState<{ installed: boolean; running: boolean; models: string[] } | null>(null);
  const engine = config.engine ?? "claude";

  useEffect(() => {
    if (engine === "ollama" && !ollamaStatus) {
      fetch("/api/ollama/status")
        .then((r) => r.json())
        .then((status) => {
          setOllamaStatus(status);
          // Auto-set ollamaModel if not already set
          if (!config.ollamaModel && status.models?.length > 0) {
            update({ ollamaModel: status.models[0] });
          }
        })
        .catch(() => setOllamaStatus({ installed: false, running: false, models: [] }));
    }
  }, [engine]);

  return (
    <>
      <Field label="Engine">
        <select
          value={engine}
          onChange={(e) => update({ engine: e.target.value as "claude" | "ollama" })}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <option value="claude">Claude Code</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </Field>

      <Field label="Prompt">
        <textarea
          value={config.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder="Describe what this agent should do..."
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm resize-none"
        />
      </Field>
      <Field label="System Prompt">
        <textarea
          value={config.systemPrompt ?? ""}
          onChange={(e) => update({ systemPrompt: e.target.value })}
          placeholder="Optional system instructions..."
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm resize-none"
        />
      </Field>

      {engine === "claude" ? (
        <>
          <Field label="Model">
            <select
              value={config.model ?? "sonnet"}
              onChange={(e) => update({ model: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </Field>
          <Field label="Max Turns">
            <input
              type="number"
              value={config.maxTurns ?? 25}
              onChange={(e) => update({ maxTurns: parseInt(e.target.value) || 25 })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Max Budget (USD)">
            <input
              type="number"
              step="0.1"
              value={config.maxBudgetUsd ?? 1.0}
              onChange={(e) => update({ maxBudgetUsd: parseFloat(e.target.value) || 1.0 })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </Field>
        </>
      ) : (
        <Field label="Ollama Model">
          {ollamaStatus === null ? (
            <p className="text-xs text-muted-foreground">Checking Ollama...</p>
          ) : !ollamaStatus.installed ? (
            <p className="text-xs text-destructive">Ollama not installed. Install from ollama.com</p>
          ) : !ollamaStatus.running ? (
            <p className="text-xs text-warning">Ollama not running. Start with: ollama serve</p>
          ) : ollamaStatus.models.length === 0 ? (
            <p className="text-xs text-warning">No models found. Pull one with: ollama pull llama3</p>
          ) : (
            <select
              value={config.ollamaModel ?? ollamaStatus.models[0]}
              onChange={(e) => update({ ollamaModel: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {ollamaStatus.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </Field>
      )}

      <div className="border-t border-border pt-3 mt-3">
        <ToolPicker
          selectedTools={config.allowedTools ?? []}
          selectedMcpServers={config.mcpServers ?? []}
          onToolsChange={(tools) => update({ allowedTools: tools })}
          onMcpServersChange={(servers) => update({ mcpServers: servers })}
        />
      </div>
    </>
  );
}

function ExpressionField({ nodeId, config }: { nodeId: string; config: ConditionConfig }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  return (
    <Field label="Expression">
      <textarea
        value={config.expression}
        onChange={(e) =>
          updateNodeData(nodeId, { config: { ...config, expression: e.target.value } } as any)
        }
        placeholder="input.includes('done')"
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono resize-none"
      />
    </Field>
  );
}

function CodeFields({ nodeId, config }: { nodeId: string; config: TransformConfig }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const update = (c: Partial<TransformConfig>) =>
    updateNodeData(nodeId, { config: { ...config, ...c } } as any);

  const placeholders: Record<string, string> = {
    python: 'import sys, json\ndata = json.load(sys.stdin)\n# process data\nprint(json.dumps(data))',
    node: 'const chunks = [];\nprocess.stdin.on("data", c => chunks.push(c));\nprocess.stdin.on("end", () => {\n  const input = JSON.parse(chunks.join(""));\n  // process\n  console.log(JSON.stringify(input));\n});',
    bash: '# Input available via stdin and $INPUT env var\necho "$INPUT" | jq .field',
  };

  return (
    <>
      <Field label="Runtime">
        <select
          value={config.runtime ?? "python"}
          onChange={(e) => update({ runtime: e.target.value as TransformConfig["runtime"] })}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <option value="python">Python</option>
          <option value="node">Node.js</option>
          <option value="bash">Bash</option>
        </select>
      </Field>
      <Field label="Code">
        <textarea
          value={config.code ?? ""}
          onChange={(e) => update({ code: e.target.value })}
          placeholder={placeholders[config.runtime ?? "python"]}
          rows={10}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono resize-y leading-relaxed"
          spellCheck={false}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        Input from previous node is passed via stdin and $INPUT env var. Output is stdout.
      </p>
    </>
  );
}

function OutputFields({ nodeId, config }: { nodeId: string; config: OutputConfig }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const update = (c: Partial<OutputConfig>) =>
    updateNodeData(nodeId, { config: { ...config, ...c } } as any);

  return (
    <Field label="Output Type">
      <select
        value={config.type}
        onChange={(e) => update({ type: e.target.value as OutputConfig["type"] })}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      >
        <option value="log">Log</option>
        <option value="webhook">Webhook</option>
        <option value="file">File</option>
        <option value="notification">Notification</option>
        <option value="claude-code">Claude Code (channel)</option>
      </select>
      {config.type === "claude-code" && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Output will be pushed to any connected Claude Code session via the OpenConclave channel.
        </p>
      )}
    </Field>
  );
}
