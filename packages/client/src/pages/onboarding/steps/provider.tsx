import { useState } from "react";
import { api } from "@/lib/api";
import { I } from "../atoms";

export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType: string;
  supportsModelList: boolean;
}

interface PresetDef {
  id: string;
  name: string;
  url: string;
  keysUrl: string;
  placeholder: string;
  supportsModelList: boolean;
}

const PRESETS: PresetDef[] = [
  { id: "anthropic", name: "Anthropic", url: "https://api.anthropic.com/v1", keysUrl: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-...", supportsModelList: true },
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1", keysUrl: "https://platform.openai.com/api-keys", placeholder: "sk-...", supportsModelList: true },
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api/v1", keysUrl: "https://openrouter.ai/settings/keys", placeholder: "sk-or-...", supportsModelList: true },
  { id: "gemini", name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", keysUrl: "https://aistudio.google.com/apikey", placeholder: "AIza...", supportsModelList: true },
];

export function ProviderStep({
  providers,
  reload,
}: {
  providers: ProviderInfo[];
  reload: () => void;
}) {
  const [presetId, setPresetId] = useState<string>(PRESETS[0]!.id);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, number>>({});

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;

  const addProvider = async () => {
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/providers", {
        id: preset.id,
        name: preset.name,
        baseUrl: preset.url,
        apiKey: key,
        apiType: "chat",
        supportsModelList: preset.supportsModelList,
      });
      setKey("");
      reload();
      // fire-and-forget model count probe for the freshly-added provider
      api.get<{ models: string[] }>(`/providers/${preset.id}/models`)
        .then((d) => setModelsByProvider((prev) => ({ ...prev, [preset.id]: d.models?.length ?? 0 })))
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add provider");
    }
    setBusy(false);
  };

  return (
    <div className="ob-page">
      <div className="ob-eyebrow">Step 02 · AI Provider</div>
      <h1 className="ob-h1">Add at least one AI provider</h1>
      <p className="ob-lede">
        Agents need an LLM to run. Add an API key below, or skip and use local models with Ollama in the next step.
      </p>

      <div className="ds-card">
        <h2 className="ob-h2" style={{ marginBottom: 10 }}>Quick presets</h2>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset ${presetId === p.id ? "active" : ""}`}
              onClick={() => setPresetId(p.id)}
              type="button"
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="ds-grid-2">
          <div className="ds-field">
            <label>Provider ID</label>
            <input className="ds-input mono" value={preset.id} readOnly />
          </div>
          <div className="ds-field">
            <label>Display Name</label>
            <input className="ds-input" value={preset.name} readOnly />
          </div>
        </div>
        <div className="ds-field">
          <label>Base URL</label>
          <input className="ds-input mono" value={preset.url} readOnly />
        </div>
        <div className="ds-field">
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>API Key</span>
            <a
              href={preset.keysUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--accent)",
                fontSize: 10.5,
                textTransform: "none",
                letterSpacing: "normal",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                textDecoration: "none",
              }}
            >
              Get {preset.name} key <I.External style={{ width: 10, height: 10 }} />
            </a>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="ds-input mono"
              placeholder={preset.placeholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type={showKey ? "text" : "password"}
            />
            <button
              className="ds-btn ds-btn-secondary"
              onClick={() => setShowKey(!showKey)}
              type="button"
              style={{ padding: "0 10px" }}
            >
              {showKey ? <I.EyeOff /> : <I.Eye />}
            </button>
          </div>
        </div>

        <button
          className="ds-btn ds-btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={addProvider}
          disabled={!key || busy}
        >
          {busy ? <><I.Loader style={{ width: 14, height: 14 }} /> Adding &amp; verifying…</> : <><I.Plus /> Add &amp; verify provider</>}
        </button>
        <div className="hint">We&rsquo;ll make a tiny models-list call to confirm the key works before saving it.</div>
        {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
      </div>

      {providers.length > 0 && (
        <>
          <p className="uppercase-label" style={{ marginTop: 28 }}>Configured providers</p>
          <div className="hc-list">
            {providers.map((p) => (
              <div key={p.id} className="hc ok">
                <div className="hc-ico"><I.Check style={{ width: 12, height: 12 }} /></div>
                <div className="hc-main">
                  <div className="name">{p.name}</div>
                  <div className="meta">
                    {p.baseUrl}
                    {modelsByProvider[p.id] !== undefined && ` · ${modelsByProvider[p.id]} models`}
                  </div>
                </div>
                <span className="ds-pill ok"><span className="ds-dot" />Verified</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
