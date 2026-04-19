import { useState } from "react";
import { FieldRow } from "../../atoms";
import type { ProviderDraft, ProviderInfo } from "./types";

const EMPTY: ProviderDraft = {
  id: "",
  name: "",
  baseUrl: "",
  apiKey: "",
  apiType: "chat",
  supportsModelList: false,
};

export function AddProviderForm({
  initial,
  existing,
  onSubmit,
  onCancel,
}: {
  initial: ProviderDraft | null;
  existing: ProviderInfo[];
  onSubmit: (draft: ProviderDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProviderDraft>(initial ?? EMPTY);
  const isEdit = existing.some((p) => p.id === draft.id);

  const set = <K extends keyof ProviderDraft>(k: K, v: ProviderDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const canSubmit = Boolean(draft.name && draft.baseUrl && (isEdit || (draft.id && draft.apiKey)));

  return (
    <div className="add-provider">
      <FieldRow label="ID" help="Unique slug, lowercase. Used in conclave definitions.">
        <input
          className="settings-input mono"
          value={draft.id}
          readOnly={isEdit}
          onChange={(e) => set("id", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          placeholder="openai"
        />
      </FieldRow>
      <FieldRow label="Display name">
        <input className="settings-input" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="OpenAI" />
      </FieldRow>
      <FieldRow label="Base URL">
        <input className="settings-input mono" value={draft.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="https://api.openai.com/v1" />
      </FieldRow>
      <FieldRow label="API key" help={isEdit ? "Leave blank to keep the current key." : undefined}>
        <input
          type="password"
          className="settings-input mono"
          value={draft.apiKey ?? ""}
          onChange={(e) => set("apiKey", e.target.value)}
          placeholder={isEdit ? "••••••••  (saved)" : "sk-..."}
        />
      </FieldRow>
      <FieldRow label="API type">
        <select className="settings-input" value={draft.apiType} onChange={(e) => set("apiType", e.target.value)}>
          <option value="chat">Chat Completions (universal)</option>
          <option value="responses">Responses API (OpenAI)</option>
        </select>
      </FieldRow>
      <FieldRow label="Model listing" help="Some providers (OpenAI, Ollama) expose /v1/models for auto-discovery.">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.supportsModelList}
            onChange={(e) => set("supportsModelList", e.target.checked)}
          />
          <span>Supports /v1/models</span>
        </label>
      </FieldRow>
      <div className="add-provider-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => onSubmit(draft)}>
          {isEdit ? "Save provider" : "Add provider"}
        </button>
      </div>
    </div>
  );
}
