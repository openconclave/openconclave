import { useEffect, useState, type ReactElement } from "react";
import { api } from "@/lib/api";
import { I, Sidebar, STEPS, type StarterId } from "./atoms";
import { WelcomeStep, type OnboardingPath } from "./steps/welcome";
import { ClaudeCodeStep, type ClaudeStatus } from "./steps/claude-code";
import { ProviderStep, type ProviderInfo } from "./steps/provider";
import { OllamaStep, type OllamaModelInfo, type OllamaState } from "./steps/ollama";
import { StarterStep } from "./steps/starter";
import { FirstRunStep } from "./steps/first-run";
import { ReadyStep } from "./steps/ready";

const VERSION = "1.0.15";

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [current, setCurrent] = useState(0);
  const [path, setPath] = useState<OnboardingPath>("cc");

  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus>("checking");
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaStatus, setOllamaStatus] = useState<OllamaState["status"]>("checking");
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);

  const [starter, setStarter] = useState<StarterId>("ledger");
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

  const hasAnthropic = providers.some((p) => p.id === "anthropic" || p.baseUrl.includes("anthropic"));
  const hasEmbed = ollamaModels.some((m) => m.capabilities.includes("embedding"));

  const canNext =
    stepId === "provider" ? providers.length > 0 :
    stepId === "starter" ? true :
    true;

  const showSkip = stepId === "cc" || stepId === "ollama" || stepId === "run";
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
  if (stepId === "starter") body = <StarterStep starter={starter} setStarter={setStarter} hasAnthropic={hasAnthropic} hasEmbed={hasEmbed} />;
  if (stepId === "run") body = <FirstRunStep starter={starter} onComplete={next} />;
  if (stepId === "ready") body = <ReadyStep providers={providers} ollama={ollamaState} starter={starter} finishing={finishing} onFinish={finish} />;

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
