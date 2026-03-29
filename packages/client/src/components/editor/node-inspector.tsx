import { useState, useEffect } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { X, Trash2 } from "lucide-react";
import { ToolPicker } from "./tool-picker";
import type {
  WorkflowNodeData,
  AgentConfig,
  TriggerConfig,
  ConditionConfig,
  CodeConfig,
  PromptConfig,
  OutputConfig,
} from "@openconclave/shared";

// ── Main Inspector ───────────────────────────────────────────

export function NodeInspector() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
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
            Waits for all connected inputs to complete, then combines them into a single object using each source node's label as the key.
          </p>
        )}
        {data.type === "output" && (
          <OutputFields nodeId={selectedNode.id} config={data.config as OutputConfig} />
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

// ── Shared ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const INPUT_CLASS = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm";
const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`;

// ── Trigger ──────────────────────────────────────────────────

function TriggerFields({ nodeId, config }: { nodeId: string; config: TriggerConfig }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<TriggerConfig>) => updateNodeConfig(nodeId, c);

  return (
    <>
      <Field label="Type">
        <select value={config.type} onChange={(e) => update({ type: e.target.value as TriggerConfig["type"] })} className={INPUT_CLASS}>
          <option value="manual">Manual</option>
          <option value="cron">Cron</option>
          <option value="webhook">Webhook</option>
          <option value="channel">Channel (Claude Code)</option>
          <option value="telegram">Telegram</option>
        </select>
      </Field>
      {config.type === "telegram" && (
        <Field label="Chat ID">
          <input type="text" value={config.chatId ?? ""} onChange={(e) => update({ chatId: e.target.value })} placeholder="1470461098" className={MONO_INPUT_CLASS} />
          <p className="mt-1 text-[10px] text-muted-foreground">Messages from this chat will trigger the workflow.</p>
        </Field>
      )}
      {config.type === "cron" && (
        <Field label="Cron Expression">
          <input type="text" value={config.cron ?? ""} onChange={(e) => update({ cron: e.target.value })} placeholder="0 9 * * 1-5" className={MONO_INPUT_CLASS} />
        </Field>
      )}
      {config.type === "webhook" && (
        <Field label="Webhook Path">
          <input type="text" value={config.webhookPath ?? ""} onChange={(e) => update({ webhookPath: e.target.value })} placeholder="/hooks/my-trigger" className={MONO_INPUT_CLASS} />
        </Field>
      )}
      {config.type === "channel" && (
        <p className="text-[10px] text-muted-foreground px-1">Triggered from Claude Code via the OpenConclave channel.</p>
      )}
      {(config.type === "manual" || config.type === "cron") && (
        <Field label="Input Prompt">
          <textarea value={config.prompt ?? ""} onChange={(e) => update({ prompt: e.target.value })} placeholder="Initial data passed to the first node..." rows={3} className={`${INPUT_CLASS} resize-none`} />
        </Field>
      )}
    </>
  );
}

// ── Agent ────────────────────────────────────────────────────

function AgentFields({ nodeId, config }: { nodeId: string; config: AgentConfig }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<AgentConfig>) => updateNodeConfig(nodeId, c);

  const [ollamaStatus, setOllamaStatus] = useState<{
    installed: boolean;
    running: boolean;
    models: string[];
  } | null>(null);
  const engine = config.engine ?? "claude";

  useEffect(() => {
    if (engine === "ollama" && !ollamaStatus) {
      fetch("/api/ollama/status")
        .then((r) => r.json())
        .then((status: { installed: boolean; running: boolean; models: string[] }) => {
          setOllamaStatus(status);
          if (!config.ollamaModel && status.models.length > 0) {
            update({ ollamaModel: status.models[0] });
          }
        })
        .catch(() => setOllamaStatus({ installed: false, running: false, models: [] }));
    }
  }, [engine]);

  return (
    <>
      <Field label="Engine">
        <select value={engine} onChange={(e) => update({ engine: e.target.value as AgentConfig["engine"] })} className={INPUT_CLASS}>
          <option value="claude">Claude Code</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </Field>

      <Field label="Instructions (System Prompt)">
        <textarea value={config.systemPrompt ?? ""} onChange={(e) => update({ systemPrompt: e.target.value })} placeholder="Agent's role and behavior. Input comes from the previous node automatically." rows={4} className={`${INPUT_CLASS} resize-none`} />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        The agent receives input from the previous node as a user message. Instructions define the agent's role and behavior.
      </p>

      {engine === "claude" ? (
        <>
          <Field label="Model">
            <select value={config.model ?? "sonnet"} onChange={(e) => update({ model: e.target.value })} className={INPUT_CLASS}>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </Field>
          <Field label="Max Turns">
            <input type="number" value={config.maxTurns ?? 25} onChange={(e) => update({ maxTurns: parseInt(e.target.value) || 25 })} className={INPUT_CLASS} />
          </Field>
          <Field label="Max Budget (USD)">
            <input type="number" step="0.1" value={config.maxBudgetUsd ?? 1.0} onChange={(e) => update({ maxBudgetUsd: parseFloat(e.target.value) || 1.0 })} className={INPUT_CLASS} />
          </Field>
        </>
      ) : (
        <>
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
            <select value={config.ollamaModel ?? ollamaStatus.models[0]} onChange={(e) => update({ ollamaModel: e.target.value })} className={INPUT_CLASS}>
              {ollamaStatus.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </Field>
        <label className="flex items-center gap-2 px-1 cursor-pointer">
          <input
            type="checkbox"
            checked={config.thinking ?? true}
            onChange={(e) => update({ thinking: e.target.checked })}
            className="rounded border-border"
          />
          <span className="text-xs text-muted-foreground">Enable thinking (disable if model loops with tools)</span>
        </label>
        </>
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

// ── Condition ────────────────────────────────────────────────

function ConditionFields({ nodeId, config }: { nodeId: string; config: ConditionConfig }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  return (
    <Field label="Expression">
      <textarea
        value={config.expression}
        onChange={(e) => updateNodeConfig(nodeId, { expression: e.target.value })}
        placeholder="input.includes('done')"
        rows={3}
        className={`${MONO_INPUT_CLASS} resize-none`}
      />
    </Field>
  );
}

// ── Code ─────────────────────────────────────────────────────

const CODE_PLACEHOLDERS: Record<string, string> = {
  python: 'import sys, json\ndata = json.load(sys.stdin)\n# process data\nprint(json.dumps(data))',
  node: 'const chunks = [];\nprocess.stdin.on("data", c => chunks.push(c));\nprocess.stdin.on("end", () => {\n  const input = JSON.parse(chunks.join(""));\n  console.log(JSON.stringify(input));\n});',
  bash: '# Input available via stdin and $INPUT env var\necho "$INPUT" | jq .field',
};

function CodeFields({ nodeId, config }: { nodeId: string; config: CodeConfig }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<CodeConfig>) => updateNodeConfig(nodeId, c);

  return (
    <>
      <Field label="Runtime">
        <select value={config.runtime ?? "python"} onChange={(e) => update({ runtime: e.target.value as CodeConfig["runtime"] })} className={INPUT_CLASS}>
          <option value="python">Python</option>
          <option value="node">Node.js</option>
          <option value="bash">Bash</option>
        </select>
      </Field>
      <Field label="Code">
        <textarea
          value={config.code ?? ""}
          onChange={(e) => update({ code: e.target.value })}
          placeholder={CODE_PLACEHOLDERS[config.runtime ?? "python"]}
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

// ── Output ───────────────────────────────────────────────────

function PromptFields({ nodeId, config }: { nodeId: string; config: PromptConfig }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  return (
    <>
      <Field label="Question">
        <textarea
          value={config.question ?? ""}
          onChange={(e) => updateNodeConfig(nodeId, { question: e.target.value })}
          placeholder="What should the workflow ask? e.g., 'Should I proceed with deployment?'"
          rows={3}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        Pauses the workflow and sends this question via the channel. The workflow resumes when a response is received. Input from the previous node is included as context.
      </p>
    </>
  );
}

function OutputFields({ nodeId, config }: { nodeId: string; config: OutputConfig }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<OutputConfig>) => updateNodeConfig(nodeId, c);

  return (
    <Field label="Output Type">
      <select value={config.type} onChange={(e) => update({ type: e.target.value as OutputConfig["type"] })} className={INPUT_CLASS}>
        <option value="log">Log</option>
        <option value="claude-code">Claude Code (channel)</option>
        <option value="telegram">Telegram</option>
      </select>
      {config.type === "claude-code" && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Output will be pushed to any connected Claude Code session via the OpenConclave channel.
        </p>
      )}
      {config.type === "telegram" && (
        <>
          <input type="text" value={config.chatId ?? ""} onChange={(e) => update({ chatId: e.target.value })} placeholder="Chat ID" className={`mt-2 ${MONO_INPUT_CLASS}`} />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Send output to this Telegram chat. Get your ID from /chatid on the bot.
          </p>
        </>
      )}
    </Field>
  );
}
