import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Save, Eye, EyeOff, Plus, Trash2, Plug, TestTube, Pencil, Sparkles } from "lucide-react";

type SettingsMap = Record<string, string>;

const settingsConfig = [
  {
    key: "telegram_bot_token",
    label: "Telegram Bot Token",
    description: "Bot token from @BotFather. Required for Telegram triggers.",
    secret: true,
    placeholder: "123456:ABC-DEF...",
  },
  {
    key: "ollama_url",
    label: "Ollama URL",
    description: "Ollama API endpoint. Default: http://localhost:11434",
    secret: false,
    placeholder: "http://localhost:11434",
  },
];

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType: string;
  supportsModelList: boolean;
}

const INPUT = "flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono";
const BTN = "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors";

export function SettingsPage() {
  const [values, setValues] = useState<SettingsMap>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // Providers
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({ id: "", name: "", baseUrl: "", apiKey: "", apiType: "chat", supportsModelList: false });
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<SettingsMap>("/settings").then(setValues).catch(() => {});
    loadProviders();
  }, []);

  const loadProviders = () => {
    api.get<{ providers: ProviderInfo[] }>("/providers").then((data) => setProviders(data.providers)).catch(() => {});
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/settings", values);
      if (values.telegram_bot_token) {
        await api.post("/telegram/restart", {}).catch(() => {});
      }
      toast("Settings saved", "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to save: ${message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAddProvider = async () => {
    if (!newProvider.id || !newProvider.name || !newProvider.baseUrl || !newProvider.apiKey) {
      toast("All fields are required", "error");
      return;
    }
    try {
      await api.post("/providers", newProvider);
      toast(`Provider "${newProvider.name}" added`, "success");
      setNewProvider({ id: "", name: "", baseUrl: "", apiKey: "", apiType: "chat", supportsModelList: false });
      setShowAddProvider(false);
      loadProviders();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to add provider: ${message}`, "error");
    }
  };

  const handleEditProvider = (p: ProviderInfo) => {
    setNewProvider({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: "", apiType: p.apiType, supportsModelList: p.supportsModelList });
    setShowAddProvider(true);
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      await api.delete(`/providers/${id}`);
      toast("Provider removed", "success");
      loadProviders();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to delete: ${message}`, "error");
    }
  };

  const handleTestProvider = async (id: string) => {
    setTestingProvider(id);
    setTestResult({ ...testResult, [id]: "" });
    try {
      const data = await api.get<{ models: string[] }>(`/providers/${id}/models`);
      const count = data.models?.length ?? 0;
      setTestResult({ ...testResult, [id]: count > 0 ? `${count} models available` : "Connected but no models found" });
    } catch {
      setTestResult({ ...testResult, [id]: "Connection failed" });
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <>
      <Header
        title="Settings"
        actions={
          <button
            onClick={handleSave}
            disabled={saving}
            className={`${BTN} bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50`}
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-8">

          {/* General Settings */}
          <section>
            <h2 className="text-lg font-semibold mb-4">General</h2>
            <div className="space-y-4">
              {settingsConfig.map((cfg) => (
                <div key={cfg.key} className="rounded-lg border border-border bg-card p-4">
                  <label className="block text-sm font-medium mb-1">{cfg.label}</label>
                  <p className="text-xs text-muted-foreground mb-3">{cfg.description}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type={cfg.secret && !showSecrets[cfg.key] ? "password" : "text"}
                      value={values[cfg.key] ?? ""}
                      onChange={(e) => setValues({ ...values, [cfg.key]: e.target.value })}
                      placeholder={cfg.placeholder}
                      className={INPUT}
                    />
                    {cfg.secret && (
                      <button
                        onClick={() =>
                          setShowSecrets({ ...showSecrets, [cfg.key]: !showSecrets[cfg.key] })
                        }
                        className="text-muted-foreground hover:text-foreground p-1.5"
                      >
                        {showSecrets[cfg.key] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* AI Providers */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">AI Providers</h2>
              <button
                onClick={() => setShowAddProvider(!showAddProvider)}
                className={`${BTN} bg-primary/10 text-primary hover:bg-primary/20`}
              >
                <Plus className="h-4 w-4" />
                Add Provider
              </button>
            </div>

            {showAddProvider && (
              <div className="rounded-lg border border-primary/30 bg-card p-4 mb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">ID (unique)</label>
                    <input
                      type="text"
                      value={newProvider.id}
                      onChange={(e) => setNewProvider({ ...newProvider, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                      placeholder="openai"
                      readOnly={providers.some((p) => p.id === newProvider.id)}
                      className={`${INPUT}${providers.some((p) => p.id === newProvider.id) ? " opacity-50" : ""}`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Name</label>
                    <input
                      type="text"
                      value={newProvider.name}
                      onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                      placeholder="OpenAI"
                      className={INPUT}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Base URL</label>
                  <input
                    type="text"
                    value={newProvider.baseUrl}
                    onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className={INPUT + " w-full"}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">API Key{providers.some((p) => p.id === newProvider.id) ? " (leave blank to keep current)" : ""}</label>
                  <input
                    type="password"
                    value={newProvider.apiKey}
                    onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                    placeholder={providers.some((p) => p.id === newProvider.id) ? "Leave blank to keep current key" : "sk-..."}
                    className={INPUT + " w-full"}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">API Type</label>
                    <select
                      value={newProvider.apiType}
                      onChange={(e) => setNewProvider({ ...newProvider, apiType: e.target.value })}
                      className={INPUT + " w-full"}
                    >
                      <option value="chat">Chat Completions (universal)</option>
                      <option value="responses">Responses API (OpenAI)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer pb-1.5">
                      <input
                        type="checkbox"
                        checked={newProvider.supportsModelList}
                        onChange={(e) => setNewProvider({ ...newProvider, supportsModelList: e.target.checked })}
                        className="rounded border-border"
                      />
                      <span className="text-xs text-muted-foreground">Supports model listing</span>
                    </label>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowAddProvider(false)} className={`${BTN} text-muted-foreground hover:text-foreground`}>
                    Cancel
                  </button>
                  <button onClick={handleAddProvider} className={`${BTN} bg-primary text-primary-foreground hover:bg-primary/90`}>
                    <Plug className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
            )}

            {providers.length === 0 && !showAddProvider ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-border bg-card p-4">
                No AI providers configured. Add one to use OpenAI, OpenRouter, Gemini, or any OpenAI-compatible API in your workflows.
              </p>
            ) : (
              <div className="space-y-3">
                {providers.map((p) => (
                  <div key={p.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{p.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            {p.apiType === "responses" ? "Responses API" : "Chat Completions"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">{p.baseUrl}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEditProvider(p)}
                          className="text-muted-foreground hover:text-foreground p-1.5"
                          title="Edit provider"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleTestProvider(p.id)}
                          disabled={testingProvider === p.id}
                          className="text-muted-foreground hover:text-foreground p-1.5 disabled:opacity-50"
                          title="Test connection"
                        >
                          <TestTube className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(p.id)}
                          className="text-muted-foreground hover:text-destructive p-1.5"
                          title="Remove provider"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {testResult[p.id] != null && (
                      <p className={`text-xs mt-2 ${testResult[p.id]!.includes("failed") ? "text-destructive" : "text-success"}`}>
                        {testResult[p.id]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Setup Wizard */}
          <section>
            <h2 className="text-lg font-semibold mb-4">Setup</h2>
            <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Setup Wizard</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Re-run the onboarding wizard to reconfigure providers and Ollama.
                </p>
              </div>
              <a
                href="/?onboarding"
                className={`${BTN} bg-primary/10 text-primary hover:bg-primary/20`}
              >
                <Sparkles className="h-4 w-4" />
                Run Wizard
              </a>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
