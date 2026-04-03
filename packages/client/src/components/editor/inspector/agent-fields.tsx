import { useState, useEffect } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { AgentConfig, ToolConfig } from "@openconclave/shared";
import { Terminal, Server, BookOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, INPUT_CLASS } from "./shared";

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiType: string;
  supportsModelList: boolean;
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: string[];
}

interface AgentFieldsProps {
  nodeId: string;
  config: AgentConfig;
}

export function AgentFields({ nodeId, config }: AgentFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<AgentConfig>) => updateNodeConfig(nodeId, c);

  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const engine = config.engine ?? "claude";

  useEffect(() => {
    if (engine === "ollama" && !ollamaStatus) {
      fetch("/api/ollama/status")
        .then((r) => r.json())
        .then((status: OllamaStatus) => {
          setOllamaStatus(status);
          if (!config.ollamaModel && status.models.length > 0) {
            update({ ollamaModel: status.models[0] });
          }
        })
        .catch(() => setOllamaStatus({ installed: false, running: false, models: [] }));
    }
  }, [engine]);

  useEffect(() => {
    if (engine === "openai") {
      fetch("/api/providers")
        .then((r) => r.json())
        .then((data: { providers: ProviderInfo[] }) => {
          setProviders(data.providers ?? []);
          if (!config.providerId && data.providers?.length > 0) {
            update({ providerId: data.providers[0]!.id });
          }
        })
        .catch(() => setProviders([]));
    }
  }, [engine]);

  useEffect(() => {
    if (engine === "openai" && config.providerId) {
      const provider = providers.find((p) => p.id === config.providerId);
      if (provider?.supportsModelList) {
        setLoadingModels(true);
        fetch(`/api/providers/${config.providerId}/models`)
          .then((r) => r.json())
          .then((data: { models: string[] }) => {
            setProviderModels(data.models ?? []);
            if (!config.openaiModel && data.models?.length > 0) {
              update({ openaiModel: data.models[0] });
            }
          })
          .catch(() => setProviderModels([]))
          .finally(() => setLoadingModels(false));
      } else {
        setProviderModels([]);
      }
    }
  }, [engine, config.providerId, providers]);

  const selectedProvider = providers.find((p) => p.id === config.providerId);

  return (
    <>
      <Field label="Engine">
        <select
          value={engine}
          onChange={(e) => update({ engine: e.target.value as AgentConfig["engine"] })}
          className={INPUT_CLASS}
        >
          <option value="claude">Claude Code</option>
          <option value="ollama">Ollama (local)</option>
          <option value="openai">OpenAI-compatible</option>
          <option value="debug">Debug (Static Text)</option>
        </select>
      </Field>

      {engine !== "debug" && (
        <>
          <Field label="Instructions (System Prompt)">
            <textarea
              value={config.systemPrompt ?? ""}
              onChange={(e) => update({ systemPrompt: e.target.value })}
              placeholder="Agent's role and behavior. Input comes from the previous node automatically."
              rows={4}
              className={`${INPUT_CLASS} resize-none`}
            />
          </Field>
          <p className="text-[10px] text-muted-foreground px-1">
            The agent receives input from the previous node as a user message. Instructions define the
            agent's role and behavior.
          </p>
        </>
      )}

      {engine === "claude" && (
        <>
          <Field label="Model">
            <select
              value={config.model ?? "sonnet"}
              onChange={(e) => update({ model: e.target.value })}
              className={INPUT_CLASS}
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
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Max Budget (USD)">
            <input
              type="number"
              step="0.1"
              value={config.maxBudgetUsd ?? 1.0}
              onChange={(e) => update({ maxBudgetUsd: parseFloat(e.target.value) || 1.0 })}
              className={INPUT_CLASS}
            />
          </Field>
        </>
      )}

      {engine === "ollama" && (
        <>
          <Field label="Ollama Model">
            {ollamaStatus === null ? (
              <p className="text-xs text-muted-foreground">Checking Ollama...</p>
            ) : !ollamaStatus.installed ? (
              <p className="text-xs text-destructive">
                Ollama not installed. Install from ollama.com
              </p>
            ) : !ollamaStatus.running ? (
              <p className="text-xs text-warning">Ollama not running. Start with: ollama serve</p>
            ) : ollamaStatus.models.length === 0 ? (
              <p className="text-xs text-warning">
                No models found. Pull one with: ollama pull llama3
              </p>
            ) : (
              <select
                value={config.ollamaModel ?? ollamaStatus.models[0]}
                onChange={(e) => update({ ollamaModel: e.target.value })}
                className={INPUT_CLASS}
              >
                {ollamaStatus.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
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
            <span className="text-xs text-muted-foreground">
              Enable thinking (disable if model loops with tools)
            </span>
          </label>
        </>
      )}

      {engine === "openai" && (
        <>
          <Field label="Provider">
            {providers.length === 0 ? (
              <p className="text-xs text-warning">
                No providers configured.{" "}
                <a href="/settings" className="underline text-primary hover:text-primary/80">
                  Add one in Settings
                </a>
              </p>
            ) : (
              <select
                value={config.providerId ?? ""}
                onChange={(e) =>
                  update({ providerId: e.target.value, openaiModel: undefined })
                }
                className={INPUT_CLASS}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {selectedProvider && (
            <Field label="Model">
              {loadingModels ? (
                <p className="text-xs text-muted-foreground">Loading models...</p>
              ) : selectedProvider.supportsModelList && providerModels.length > 0 ? (
                <select
                  value={config.openaiModel ?? providerModels[0]}
                  onChange={(e) => update({ openaiModel: e.target.value })}
                  className={INPUT_CLASS}
                >
                  {providerModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={config.openaiModel ?? ""}
                  onChange={(e) => update({ openaiModel: e.target.value })}
                  placeholder="e.g. gpt-4o, claude-3-sonnet, mistral-large"
                  className={INPUT_CLASS}
                />
              )}
            </Field>
          )}
          <p className="text-[10px] text-muted-foreground px-1">
            {selectedProvider?.apiType === "responses"
              ? "Using OpenAI Responses API (with reasoning)"
              : "Using Chat Completions API"}
          </p>
        </>
      )}

      {engine === "debug" && (
        <>
          <Field label="Response Text">
            <textarea
              value={config.debugResponse ?? ""}
              onChange={(e) => update({ debugResponse: e.target.value })}
              placeholder="Static text this agent will return (no LLM call)"
              rows={4}
              className={`${INPUT_CLASS} resize-none`}
            />
          </Field>
          <p className="text-[10px] text-muted-foreground px-1">
            Returns this text as output without making any LLM calls. Useful for testing workflows.
          </p>
        </>
      )}

      {/* Tools */}
      <div className="border-t border-border/40 pt-3 mt-3">
        <p className="text-xs font-medium mb-2">Tools</p>
        {(config.tools ?? []).length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            Drag tools from the palette onto this agent node.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(config.tools ?? []).map((tool: ToolConfig, i: number) => {
              const Icon = tool.toolType === "knowledge" ? BookOpen
                : tool.toolType === "mcp" ? Server : Terminal;
              const color = tool.toolType === "knowledge" ? "bg-node-knowledge" : "bg-node-tool";
              return (
                <span
                  key={`${tool.toolType}-${tool.toolId}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full pl-1.5 pr-1 py-0.5 text-[10px] font-medium text-white",
                    color
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {tool.toolName}
                  <button
                    onClick={() => {
                      const existing = config.tools ?? [];
                      update({ tools: existing.filter((_, idx) => idx !== i) });
                    }}
                    className="ml-0.5 rounded-full hover:bg-white/20 p-0.5"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

    </>
  );
}

