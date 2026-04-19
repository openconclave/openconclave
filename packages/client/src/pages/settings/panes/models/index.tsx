import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Section, FieldRow } from "../../atoms";
import { ProviderCard } from "./provider-card";
import { AddProviderForm } from "./add-provider-form";
import type { ProviderInfo, ProviderDraft } from "./types";

export function ModelsPane({
  values,
  setValue,
}: {
  values: Record<string, string>;
  setValue: (k: string, v: string) => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ProviderDraft | null>(null);

  const load = useCallback(() => {
    api.get<{ providers: ProviderInfo[] }>("/providers").then((d) => setProviders(d.providers)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async (draft: ProviderDraft) => {
    try {
      await api.post("/providers", draft);
      toast(`Provider "${draft.name}" saved`, "success");
      setShowAdd(false);
      setEditing(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", "error");
    }
  };

  const handleEdit = (p: ProviderInfo) => {
    setEditing({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: "", apiType: p.apiType, supportsModelList: p.supportsModelList });
    setShowAdd(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/providers/${id}`);
      toast("Provider removed", "success");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to remove", "error");
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Models & providers</h1>
          <p>Connect AI providers and local runtimes. Your conclaves can mix models from any of these — each agent picks independently.</p>
        </div>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setShowAdd((s) => !s); }}>
            {showAdd ? "Cancel" : "+ Add provider"}
          </button>
        </div>
      </div>

      {showAdd && (
        <Section title={editing ? `Edit ${editing.name}` : "Add provider"}>
          <AddProviderForm initial={editing} existing={providers} onSubmit={handleAdd} onCancel={() => { setShowAdd(false); setEditing(null); }} />
        </Section>
      )}

      <Section title="Hosted providers" sub={`${providers.length} configured`}>
        {providers.length === 0 ? (
          <div className="settings-empty">
            <div>No providers yet. Add one to use OpenAI, Anthropic, Gemini, or any OpenAI-compatible API.</div>
          </div>
        ) : (
          <div className="models-list">
            {providers.map((p) => (
              <ProviderCard key={p.id} provider={p} onEdit={() => handleEdit(p)} onDelete={() => handleDelete(p.id)} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Local runtime" sub="Ollama endpoint">
        <FieldRow label="Ollama URL" help="API endpoint for a local Ollama server. Default: http://localhost:11434">
          <input
            className="settings-input mono"
            value={values.ollama_url ?? ""}
            onChange={(e) => setValue("ollama_url", e.target.value)}
            placeholder="http://localhost:11434"
          />
        </FieldRow>
      </Section>
    </div>
  );
}
