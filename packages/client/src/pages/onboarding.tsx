import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Plug,
  Server,
  Rocket,
  ChevronRight,
  ChevronLeft,
  Plus,
  TestTube,
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Brain,
  Copy,
  Terminal,
  MessageSquareCode,
} from "lucide-react";

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType: string;
  supportsModelList: boolean;
}

interface OllamaModelInfo {
  name: string;
  capabilities: string[];
}

const STEPS = [
  { label: "Claude Code", icon: MessageSquareCode },
  { label: "AI Provider", icon: Plug },
  { label: "Ollama", icon: Server },
  { label: "Embeddings", icon: Brain },
  { label: "Ready", icon: Rocket },
];

const LAST_STEP = STEPS.length - 1;
const EMBEDDING_STEP = 3;

const INPUT = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40";
const BTN = "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";

const PROVIDER_PRESETS = [
  { id: "anthropic", name: "Anthropic", url: "https://api.anthropic.com/v1", list: true, keysUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1", list: true, keysUrl: "https://platform.openai.com/api-keys" },
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api/v1", list: true, keysUrl: "https://openrouter.ai/settings/keys" },
  { id: "gemini", name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", list: true, keysUrl: "https://aistudio.google.com/apikey" },
];

const RECOMMENDED_EMBEDDING_MODELS = [
  { name: "nomic-embed-text:latest", description: "Fast, small (274M params). Good default for most use cases." },
  { name: "qwen3-embedding:latest", description: "High quality (600M+ params). Better accuracy, more resources." },
];

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);

  // Provider state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [form, setForm] = useState({ id: "", name: "", baseUrl: "", apiKey: "", apiType: "chat", supportsModelList: false });
  const [showKey, setShowKey] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // Ollama state
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "online" | "offline" | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [modelDetails, setModelDetails] = useState<OllamaModelInfo[]>([]);

  // Claude Code state
  const [claudeStatus, setClaudeStatus] = useState<"checking" | "installed" | "not_found" | null>(null);
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);

  // Finishing state
  const [finishing, setFinishing] = useState(false);

  // Clipboard feedback
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const loadProviders = () => {
    api.get<{ providers: ProviderInfo[] }>("/providers").then((d) => setProviders(d.providers)).catch(() => {});
  };

  useEffect(() => { loadProviders(); checkClaudeCode(); }, []);

  const checkClaudeCode = async () => {
    setClaudeStatus("checking");
    try {
      const data = await api.get<{ installed: boolean; version: string | null }>("/claude-code/status");
      setClaudeStatus(data.installed ? "installed" : "not_found");
      setClaudeVersion(data.version ?? null);
    } catch {
      setClaudeStatus("not_found");
    }
  };

  // Auto-check Ollama when reaching Ollama or Embeddings step
  useEffect(() => {
    if (step === 2 || step === EMBEDDING_STEP) fetchOllamaStatus();
  }, [step]);

  const fetchOllamaStatus = async () => {
    setOllamaStatus("checking");
    try {
      const data = await api.get<{
        installed: boolean;
        running: boolean;
        models: string[];
        modelDetails?: OllamaModelInfo[];
      }>("/ollama/status");
      setOllamaStatus(data.running ? "online" : "offline");
      setOllamaModels(data.models ?? []);
      setModelDetails(data.modelDetails ?? []);
    } catch {
      setOllamaStatus("offline");
      setOllamaModels([]);
      setModelDetails([]);
    }
  };

  const embeddingModels = modelDetails.filter((m) => m.capabilities.includes("embedding"));
  const chatModels = modelDetails.filter((m) => m.capabilities.includes("completion"));

  const handleAddProvider = async () => {
    if (!form.id || !form.name || !form.baseUrl || !form.apiKey) return;
    setAdding(true);
    try {
      await api.post("/providers", form);
      setForm({ id: "", name: "", baseUrl: "", apiKey: "", apiType: "chat", supportsModelList: false });
      setShowKey(false);
      loadProviders();
    } catch { /* toast would be nice but keeping it simple */ }
    setAdding(false);
  };

  const handleTestProvider = async (id: string) => {
    setTestingId(id);
    try {
      const data = await api.get<{ models: string[] }>(`/providers/${id}/models`);
      const count = data.models?.length ?? 0;
      setTestResult((prev) => ({ ...prev, [id]: { ok: count > 0, msg: `${count} models available` } }));
    } catch {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, msg: "Connection failed" } }));
    }
    setTestingId(null);
  };

  const handleSaveOllamaUrl = async () => {
    await api.put("/settings", { ollama_url: ollamaUrl }).catch(() => {});
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      await api.put("/settings", { onboarding_completed: "true" });
      onComplete();
    } catch {
      setFinishing(false);
    }
  };

  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(null), 2000);
    }).catch(() => {});
  };

  const canProceedFromProvider = providers.length > 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left rail — step indicator */}
      <div className="hidden md:flex w-64 flex-col border-r border-border bg-card/50 p-6">
        <div className="flex items-center gap-2 mb-10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            OC
          </div>
          <span className="text-lg font-semibold tracking-tight">OpenConclave</span>
        </div>

        <nav className="flex-1 space-y-1">
          {STEPS.map((s, i) => (
            <div
              key={s.label}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                i === step
                  ? "bg-primary/10 text-primary"
                  : i < step
                    ? "text-foreground"
                    : "text-muted-foreground/50"
              )}
            >
              <div className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors",
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-success text-success-foreground"
                    : "bg-muted text-muted-foreground/50"
              )}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              {s.label}
            </div>
          ))}
        </nav>

        <p className="text-[10px] text-muted-foreground/50 mt-auto">
          You can always change these in Settings later.
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile step indicator */}
        <div className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-border">
          {STEPS.map((s, i) => (
            <div key={s.label} className={cn(
              "flex-1 h-1 rounded-full transition-colors",
              i <= step ? "bg-primary" : "bg-muted"
            )} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="max-w-xl mx-auto">
            {/* Step 0: Claude Code */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">Welcome to OpenConclave</h1>
                  <p className="text-muted-foreground mt-2 leading-relaxed">
                    OpenConclave is a visual workflow engine for AI agents.
                    The best way to use it is through <strong>Claude Code</strong> — Anthropic's CLI tool
                    that connects directly to OpenConclave via MCP.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      claudeStatus === "installed" ? "bg-success/10" : "bg-muted"
                    )}>
                      {claudeStatus === "checking" ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : claudeStatus === "installed" ? (
                        <Check className="h-5 w-5 text-success" />
                      ) : (
                        <MessageSquareCode className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {claudeStatus === "checking" && "Checking for Claude Code..."}
                        {claudeStatus === "installed" && "Claude Code is installed"}
                        {claudeStatus === "not_found" && "Claude Code not found"}
                        {claudeStatus === null && "Claude Code"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {claudeStatus === "installed" && claudeVersion
                          ? claudeVersion
                          : claudeStatus === "installed"
                            ? "Ready to connect"
                            : "Install it to get the most out of OpenConclave"}
                      </p>
                    </div>
                  </div>

                  {claudeStatus === "installed" && (
                    <div className="rounded-md bg-success/5 border border-success/20 p-3">
                      <p className="text-xs text-success">
                        You're all set. Claude Code can create, trigger, and monitor workflows
                        through the OpenConclave MCP plugin.
                      </p>
                    </div>
                  )}

                  {claudeStatus === "not_found" && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Install Claude Code to create workflows with natural language,
                        trigger runs, respond to agent prompts, and manage everything from your terminal.
                      </p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2">
                          <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <code className="text-xs font-mono text-foreground">npm install -g @anthropic-ai/claude-code</code>
                        </div>
                        <button
                          onClick={() => copyCommand("npm install -g @anthropic-ai/claude-code")}
                          className={cn(
                            `${BTN} shrink-0 text-xs`,
                            copiedCmd === "npm install -g @anthropic-ai/claude-code"
                              ? "bg-success/10 text-success"
                              : "bg-secondary text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {copiedCmd === "npm install -g @anthropic-ai/claude-code" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copiedCmd === "npm install -g @anthropic-ai/claude-code" ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <a
                        href="https://docs.anthropic.com/en/docs/claude-code/overview"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Claude Code documentation <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                    What you can do with Claude Code + OpenConclave
                  </p>
                  <div className="grid gap-3">
                    <FeatureCard
                      title="Create workflows with natural language"
                      description="Describe what you want and Claude builds the workflow — nodes, edges, prompts, and all."
                    />
                    <FeatureCard
                      title="Trigger and monitor runs"
                      description="Start workflows, watch progress, and respond to agent questions from your terminal."
                    />
                    <FeatureCard
                      title="Answer agent prompts"
                      description="When a workflow asks a human-in-the-loop question, Claude Code receives and answers it."
                    />
                    <FeatureCard
                      title="Also works with Cursor, Windsurf, and other MCP clients"
                      description="Any tool that supports MCP can connect to OpenConclave."
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 1: AI Provider */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Configure an AI Provider</h1>
                  <p className="text-muted-foreground mt-1">
                    Agents need an LLM to run. Add at least one OpenAI-compatible provider.
                  </p>
                </div>

                {/* Quick presets */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Quick presets</p>
                  <div className="flex flex-wrap gap-2">
                    {PROVIDER_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => setForm({ id: preset.id, name: preset.name, baseUrl: preset.url, apiKey: form.apiKey, apiType: "chat", supportsModelList: preset.list })}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                          form.id === preset.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card hover:bg-secondary/50 text-muted-foreground"
                        )}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Provider form */}
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Provider ID</label>
                      <input
                        type="text"
                        value={form.id}
                        onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                        placeholder="openai"
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Display Name</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="OpenAI"
                        className={INPUT}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Base URL</label>
                    <input
                      type="text"
                      value={form.baseUrl}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs text-muted-foreground">API Key</label>
                      {(() => {
                        const preset = PROVIDER_PRESETS.find((p) => p.id === form.id);
                        return preset ? (
                          <a
                            href={preset.keysUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                          >
                            Get {preset.name} key <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : null;
                      })()}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type={showKey ? "text" : "password"}
                        value={form.apiKey}
                        onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                        placeholder="sk-..."
                        className={INPUT}
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="text-muted-foreground hover:text-foreground p-2"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">API Type</label>
                      <select
                        value={form.apiType}
                        onChange={(e) => setForm({ ...form, apiType: e.target.value })}
                        className={INPUT}
                      >
                        <option value="chat">Chat Completions (universal)</option>
                        <option value="responses">Responses API (OpenAI)</option>
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.supportsModelList}
                          onChange={(e) => setForm({ ...form, supportsModelList: e.target.checked })}
                          className="rounded border-border"
                        />
                        <span className="text-xs text-muted-foreground">Supports model listing</span>
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={handleAddProvider}
                    disabled={adding || !form.id || !form.name || !form.baseUrl || !form.apiKey}
                    className={`${BTN} w-full bg-primary text-primary-foreground hover:bg-primary/90`}
                  >
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Provider
                  </button>
                </div>

                {/* Added providers */}
                {providers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Configured Providers
                    </p>
                    {providers.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-success/10">
                          <Check className="h-4 w-4 text-success" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground truncate">{p.baseUrl}</p>
                        </div>
                        <button
                          onClick={() => handleTestProvider(p.id)}
                          disabled={testingId === p.id}
                          className={cn(
                            `${BTN} text-xs`,
                            testResult[p.id]?.ok
                              ? "bg-success/10 text-success"
                              : testResult[p.id]
                                ? "bg-destructive/10 text-destructive"
                                : "bg-secondary text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {testingId === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <TestTube className="h-3 w-3" />
                          )}
                          {testResult[p.id]?.msg ?? "Test"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!canProceedFromProvider && (
                  <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2">
                    <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-warning">Add at least one provider to continue.</p>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Ollama */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Local Models with Ollama</h1>
                  <p className="text-muted-foreground mt-1">
                    Ollama lets you run open-source models locally — completely free, no API key needed.
                    This step is optional.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      ollamaStatus === "online" ? "bg-success/10" : "bg-muted"
                    )}>
                      {ollamaStatus === "checking" ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : ollamaStatus === "online" ? (
                        <Check className="h-5 w-5 text-success" />
                      ) : (
                        <Server className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {ollamaStatus === "checking" && "Checking Ollama..."}
                        {ollamaStatus === "online" && "Ollama is running"}
                        {ollamaStatus === "offline" && "Ollama not detected"}
                        {ollamaStatus === null && "Ollama"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ollamaStatus === "online" && ollamaModels.length > 0
                          ? `${ollamaModels.length} model${ollamaModels.length !== 1 ? "s" : ""} installed`
                          : ollamaStatus === "online"
                            ? "Connected but no models pulled yet"
                            : "Install from ollama.com to use local models"}
                      </p>
                    </div>
                  </div>

                  {ollamaStatus === "online" && modelDetails.length > 0 && (
                    <div className="space-y-2">
                      {chatModels.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Chat models</p>
                          <div className="flex flex-wrap gap-1.5">
                            {chatModels.map((m) => (
                              <span key={m.name} className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                                {m.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {embeddingModels.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Embedding models</p>
                          <div className="flex flex-wrap gap-1.5">
                            {embeddingModels.map((m) => (
                              <span key={m.name} className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary">
                                {m.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Ollama URL</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ollamaUrl}
                        onChange={(e) => setOllamaUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        className={INPUT}
                      />
                      <button
                        onClick={async () => {
                          await handleSaveOllamaUrl();
                          fetchOllamaStatus();
                        }}
                        className={`${BTN} bg-secondary text-foreground hover:bg-secondary/80 shrink-0`}
                      >
                        <TestTube className="h-3 w-3" />
                        Check
                      </button>
                    </div>
                  </div>

                  {ollamaStatus === "offline" && (
                    <div className="rounded-md bg-muted/50 p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Don't have Ollama? No problem — your cloud providers work great.
                        You can always install it later.
                      </p>
                      <a
                        href="https://ollama.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Get Ollama <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Embeddings */}
            {step === EMBEDDING_STEP && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Embedding Model for Knowledge</h1>
                  <p className="text-muted-foreground mt-1">
                    Knowledge Bases use an Ollama embedding model to turn documents into vectors
                    for semantic search. Agents can then search your data during workflow runs.
                  </p>
                </div>

                {ollamaStatus === "online" && embeddingModels.length > 0 ? (
                  /* Has embedding models — show success */
                  <div className="rounded-lg border border-success/30 bg-success/5 p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                        <Check className="h-5 w-5 text-success" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Embedding model ready</p>
                        <p className="text-xs text-muted-foreground">
                          You have {embeddingModels.length} embedding model{embeddingModels.length !== 1 ? "s" : ""} installed.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {embeddingModels.map((m) => (
                        <span key={m.name} className="text-xs font-mono px-2.5 py-1 rounded-md bg-success/10 text-success border border-success/20">
                          {m.name}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      When you create a Knowledge Base, you'll pick which model to use for that base.
                    </p>
                  </div>
                ) : (
                  /* No embedding models — show instructions */
                  <>
                    {ollamaStatus === "online" ? (
                      <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2">
                        <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                        <p className="text-xs text-warning">
                          Ollama is running but no embedding models are installed. Pull one below.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 rounded-md bg-muted/50 border border-border px-3 py-2">
                        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          Ollama is not running. Start Ollama first, then pull an embedding model.
                          You can skip this and set it up later from the Knowledge page.
                        </p>
                      </div>
                    )}

                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                        Recommended models
                      </p>
                      <div className="space-y-3">
                        {RECOMMENDED_EMBEDDING_MODELS.map((model) => {
                          const cmd = `ollama pull ${model.name}`;
                          const isCopied = copiedCmd === cmd;
                          return (
                            <div key={model.name} className="rounded-lg border border-border bg-card p-4 space-y-3">
                              <div>
                                <p className="text-sm font-medium font-mono">{model.name}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2">
                                  <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  <code className="text-xs font-mono text-foreground">{cmd}</code>
                                </div>
                                <button
                                  onClick={() => copyCommand(cmd)}
                                  className={cn(
                                    `${BTN} shrink-0 text-xs`,
                                    isCopied
                                      ? "bg-success/10 text-success"
                                      : "bg-secondary text-muted-foreground hover:text-foreground"
                                  )}
                                >
                                  {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  {isCopied ? "Copied" : "Copy"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-md bg-muted/50 p-4 space-y-2">
                      <p className="text-xs font-medium">How to install</p>
                      <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                        <li>Open a terminal window</li>
                        <li>Run one of the commands above (the pull takes 30s-2min)</li>
                        <li>
                          Come back here and click{" "}
                          <button
                            onClick={fetchOllamaStatus}
                            className="text-primary hover:underline inline"
                          >
                            Refresh
                          </button>
                          {" "}to detect the new model
                        </li>
                      </ol>
                    </div>

                    {ollamaStatus === "online" && (
                      <button
                        onClick={fetchOllamaStatus}
                        className={`${BTN} w-full bg-secondary text-foreground hover:bg-secondary/80`}
                      >
                        <TestTube className="h-4 w-4" />
                        Refresh Ollama Models
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Step 4: Done */}
            {step === LAST_STEP && (
              <div className="space-y-6">
                <div className="text-center pt-8">
                  <div className="flex justify-center mb-6">
                    <div className="relative">
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
                        <Rocket className="h-10 w-10 text-primary" />
                      </div>
                      <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-success text-white">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight">You're all set!</h1>
                  <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                    OpenConclave is ready. Here's what you can do next:
                  </p>
                </div>

                <div className="grid gap-3 max-w-md mx-auto mt-6">
                  <NextStepCard
                    title="Create your first workflow"
                    description="Open the visual editor and wire up some agent nodes."
                    href="/workflows"
                  />
                  <NextStepCard
                    title="Try a pre-built workflow"
                    description="Use the MCP plugin to create workflows from templates."
                    href="/workflows"
                  />
                  <NextStepCard
                    title="Upload knowledge"
                    description="Add documents so agents can search your data during runs."
                    href="/knowledge"
                  />
                </div>

                <div className="flex justify-center mt-8">
                  <button
                    onClick={handleFinish}
                    disabled={finishing}
                    className={`${BTN} bg-primary text-primary-foreground hover:bg-primary/90 text-base px-8 py-3`}
                  >
                    {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    Go to Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom navigation */}
        <div className="border-t border-border px-6 py-4 flex items-center justify-between bg-card/50">
          <div>
            {step > 0 && step < LAST_STEP && (
              <button
                onClick={() => setStep(step - 1)}
                className={`${BTN} text-muted-foreground hover:text-foreground`}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Claude Code, Ollama, and Embeddings steps can be skipped */}
            {(step === 0 || step === 2 || step === EMBEDDING_STEP) && (
              <button
                onClick={() => setStep(step + 1)}
                className={`${BTN} text-muted-foreground hover:text-foreground`}
              >
                Skip
              </button>
            )}
            {step < LAST_STEP && (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && !canProceedFromProvider}
                className={`${BTN} bg-primary text-primary-foreground hover:bg-primary/90`}
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </div>
  );
}

function NextStepCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-4 rounded-lg border border-border bg-card/50 p-4 transition-colors hover:bg-secondary/50 hover:border-border/80 group"
    >
      <div className="flex-1">
        <h3 className="text-sm font-medium group-hover:text-primary transition-colors">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
    </a>
  );
}
