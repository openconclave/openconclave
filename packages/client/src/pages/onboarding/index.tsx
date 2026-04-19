import { useEffect, useState, type ReactElement } from "react";
import { VERSION } from "@openconclave/shared";
import { api } from "@/lib/api";
import { EMPTY_STARTER, I, Sidebar, STEPS, type Starter, type StarterId, type StarterVizKind } from "./atoms";
import { WelcomeStep, type OnboardingPath } from "./steps/welcome";
import { ClaudeCodeStep, type ClaudeStatus } from "./steps/claude-code";
import { ProviderStep, type ProviderInfo } from "./steps/provider";
import { OllamaStep, type OllamaModelInfo, type OllamaState } from "./steps/ollama";
import { StarterStep } from "./steps/starter";
import { FirstRunStep } from "./steps/first-run";
import { ReadyStep } from "./steps/ready";

interface MarketplaceEntry {
  id: string;
  title: string;
  description: string;
  toolName?: string;
  tags?: string[];
  requires?: { providers?: string[]; embeddings?: boolean };
}

function vizForId(id: string): StarterVizKind {
  if (id.includes("ledger")) return "ledger";
  if (id.includes("review")) return "review";
  if (id.includes("advisor") || id.includes("advice")) return "advisors";
  return "empty";
}

function toStarter(entry: MarketplaceEntry): Starter {
  const needs: Starter["needs"] = [];
  if (entry.requires?.providers?.includes("anthropic")) needs.push("anthropic");
  if (entry.requires?.embeddings) needs.push("ollama");
  return {
    id: entry.id,
    title: entry.title,
    toolName: entry.toolName ?? entry.id,
    desc: entry.description,
    nodes: 0,
    needs,
    viz: vizForId(entry.id),
  };
}

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [current, setCurrent] = useState(0);
  const [path, setPath] = useState<OnboardingPath>("cc");

  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus>("checking");
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaStatus, setOllamaStatus] = useState<OllamaState["status"]>("checking");
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);

  const [starter, setStarter] = useState<StarterId>("empty");
  const [starters, setStarters] = useState<Starter[]>([EMPTY_STARTER]);
  const [finishing, setFinishing] = useState(false);

  const loadProviders = () => {
    api.get<{ providers: ProviderInfo[] }>("/providers")
      .then((d) => setProviders(d.providers))
      .catch((err) => console.error("providers:", err));
  };

  const checkClaude = async () => {
    setClaudeStatus("checking");
    try {
      const d = await api.get<{ installed: boolean; version: string | null }>("/claude-code/status");
      setClaudeStatus(d.installed ? "installed" : "not_found");
      setClaudeVersion(d.version ?? null);
    } catch {
      setClaudeStatus("not_found");
    }
  };

  const fetchOllama = async () => {
    setOllamaStatus("checking");
    try {
      const d = await api.get<{
        installed: boolean;
        running: boolean;
        models: string[];
        modelDetails?: OllamaModelInfo[];
      }>("/ollama/status");
      setOllamaStatus(d.running ? "online" : "offline");
      setOllamaModels(Array.isArray(d.modelDetails) ? d.modelDetails : []);
    } catch {
      setOllamaStatus("offline");
      setOllamaModels([]);
    }
  };

  useEffect(() => {
    loadProviders();
    checkClaude();
    // Fetch featured starters from the marketplace; show first 2 + always-present empty.
    api.get<{ entries: MarketplaceEntry[] }>("/starters")
      .then((data) => {
        const featured = (data.entries ?? []).slice(0, 2).map(toStarter);
        setStarters([...featured, EMPTY_STARTER]);
        if (featured[0]) setStarter(featured[0].id);
      })
      .catch(() => {
        // Marketplace unreachable — just keep the empty option so onboarding still works.
      });
  }, []);

  // Auto-recheck Ollama whenever the Ollama step becomes active.
  const stepId = STEPS[current]?.id;
  useEffect(() => {
    if (stepId === "ollama") fetchOllama();
  }, [stepId]);

  const saveOllamaUrl = async (url: string) => {
    setOllamaUrl(url);
    try {
      await api.put("/settings", { ollama_url: url });
    } catch (err) {
      console.error("ollama url save:", err);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      await api.put("/settings", { onboarding_completed: "true" });
      onComplete();
    } catch (err) {
      console.error("finish:", err);
      setFinishing(false);
    }
  };

  const canNext =
    stepId === "provider" ? providers.length > 0 :
    stepId === "starter" ? true :
    true;

  const showSkip = stepId === "cc" || stepId === "provider" || stepId === "ollama" || stepId === "run";
  const showBack = current > 0 && stepId !== "ready";
  const showContinue = stepId !== "ready" && stepId !== "run";

  const next = () => setCurrent((c) => Math.min(STEPS.length - 1, c + 1));
  const back = () => setCurrent((c) => Math.max(0, c - 1));
  const goto = (i: number) => setCurrent(i);

  // Skip Claude-Code step if user picked "visual" path
  useEffect(() => {
    if (stepId === "cc" && path === "visual") next();
  }, [stepId, path]);

  const ollamaState: OllamaState = {
    status: ollamaStatus,
    url: ollamaUrl,
    models: ollamaModels,
  };

  let body: ReactElement | null = null;
  if (stepId === "welcome") body = <WelcomeStep path={path} setPath={setPath} />;
  if (stepId === "cc") body = <ClaudeCodeStep status={claudeStatus} version={claudeVersion} onRecheck={checkClaude} />;
  if (stepId === "provider") body = <ProviderStep providers={providers} reload={loadProviders} />;
  if (stepId === "ollama") body = <OllamaStep state={ollamaState} setUrl={saveOllamaUrl} recheck={fetchOllama} />;
  if (stepId === "starter") body = <StarterStep />;
  if (stepId === "run") body = <FirstRunStep starter={starter} starters={starters} onComplete={next} />;
  if (stepId === "ready") body = <ReadyStep providers={providers} ollama={ollamaState} starter={starter} starters={starters} finishing={finishing} onFinish={finish} />;

  return (
    <div className="ob-shell">
      <Sidebar current={current} onNav={goto} version={VERSION} />
      <div className="ob-main">
        <div className="ob-main-scroll">{body}</div>
        <div className="ob-foot">
          <div className="ob-foot-left">
            {showBack ? (
              <button className="ds-btn ds-btn-ghost" onClick={back} type="button">
                <I.ArrowL /> Back
              </button>
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
          <div className="ob-foot-right">
            {showSkip && (
              <button className="ds-btn ds-btn-ghost" onClick={next} type="button">
                Skip
              </button>
            )}
            {showContinue && (
              <button
                className="ds-btn ds-btn-primary"
                onClick={next}
                disabled={!canNext}
                type="button"
              >
                Continue <I.ArrowR />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
