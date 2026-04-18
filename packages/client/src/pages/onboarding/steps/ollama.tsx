import { useState } from "react";
import { I } from "../atoms";

export interface OllamaModelInfo {
  name: string;
  capabilities: string[];
}

export interface OllamaState {
  status: "checking" | "online" | "offline";
  url: string;
  models: OllamaModelInfo[];
}

export function OllamaStep({
  state,
  setUrl,
  recheck,
}: {
  state: OllamaState;
  setUrl: (url: string) => void;
  recheck: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const pullCmd = "ollama pull nomic-embed-text";

  const copy = (cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(cmd);
      setTimeout(() => setCopied(null), 2000);
    }).catch((err) => console.error("clipboard:", err));
  };

  const chatModels = state.models.filter((m) => m.capabilities.includes("completion"));
  const embedModels = state.models.filter((m) => m.capabilities.includes("embedding"));
  const hasEmbed = embedModels.length > 0;

  return (
    <div className="ob-page">
      <div className="ob-eyebrow">Step 03 · Local models (optional)</div>
      <h1 className="ob-h1">Run open-source models locally</h1>
      <p className="ob-lede">
        Ollama runs models on your machine — free, no API key. <strong style={{ color: "var(--text)" }}>Embeddings are required</strong> for
        knowledge bases and conclaves like <em>The Ledger</em>. Everything else is optional.
      </p>

      <div className="ds-card">
        <div className="ds-card-row">
          <div
            className={`hc-ico ${state.status === "online" ? "ok" : state.status === "offline" ? "err" : "run"}`}
            style={{ width: 28, height: 28 }}
          >
            {state.status === "checking" ? (
              <I.Loader style={{ width: 14, height: 14 }} />
            ) : state.status === "online" ? (
              <I.Check style={{ width: 14, height: 14 }} />
            ) : (
              <I.X style={{ width: 14, height: 14 }} />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div className="ds-card-title">
              {state.status === "checking"
                ? "Checking Ollama…"
                : state.status === "online"
                  ? "Ollama is running"
                  : "Ollama not detected"}
            </div>
            <div className="ds-card-sub mono" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {state.status === "online"
                ? `${state.models.length} model${state.models.length !== 1 ? "s" : ""} installed  ·  `
                : ""}
              {state.url}
            </div>
          </div>
          <button
            className="ds-btn ds-btn-secondary"
            onClick={recheck}
            disabled={state.status === "checking"}
          >
            {state.status === "checking" ? <><I.Loader style={{ width: 14, height: 14 }} /> Checking…</> : "Check"}
          </button>
        </div>

        {state.status === "online" && (
          <>
            <div className="sep" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div className="uppercase-label" style={{ marginBottom: 8 }}>Chat models</div>
                <div className="chip-row">
                  {chatModels.length === 0
                    ? <span className="faint" style={{ fontSize: 12 }}>None installed</span>
                    : chatModels.map((m) => <span key={m.name} className="chip">{m.name}</span>)}
                </div>
              </div>
              <div>
                <div className="uppercase-label" style={{ marginBottom: 8 }}>Embedding models</div>
                <div className="chip-row">
                  {embedModels.length === 0
                    ? <span className="faint" style={{ fontSize: 12 }}>None installed</span>
                    : embedModels.map((m) => <span key={m.name} className="chip accent">{m.name}</span>)}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="sep" />
        <div className="ds-field" style={{ marginBottom: 0 }}>
          <label>Ollama URL</label>
          <input
            className="ds-input mono"
            value={state.url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:11434"
          />
        </div>
      </div>

      {state.status === "online" && !hasEmbed && (
        <div className="ds-card" style={{ marginTop: 14, borderColor: "oklch(0.5 0.12 55 / 0.4)" }}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <div className="ds-card-title">
                <span style={{ color: "var(--accent)" }}>●</span> Recommended: pull{" "}
                <span className="mono">nomic-embed-text</span>
              </div>
              <div className="ds-card-sub">
                ~137 MB. Powers knowledge-base search and agents that learn across runs.
                Run this in your terminal, then click Check above.
              </div>
            </div>
          </div>
          <div className="sep" />
          <div className="cmd-row">
            <div className="cmd-box">
              <I.Terminal style={{ width: 13, height: 13, color: "var(--text-faint)", flexShrink: 0 }} />
              <code>{pullCmd}</code>
            </div>
            <button
              className="ds-btn ds-btn-secondary"
              onClick={() => copy(pullCmd)}
              style={{ color: copied === pullCmd ? "var(--ok)" : undefined }}
            >
              {copied === pullCmd ? <I.Check /> : <I.Copy />}
              {copied === pullCmd ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {state.status === "offline" && (
        <div className="ds-card quiet" style={{ marginTop: 14 }}>
          <div className="ds-card-sub" style={{ fontSize: 13 }}>
            <strong style={{ color: "var(--text)" }}>No Ollama?</strong> That&rsquo;s okay — you can still run conclaves that use cloud providers.
            You won&rsquo;t be able to use local-only features (knowledge bases, embedding overlap detection) until you install it.
          </div>
          <div className="sep" />
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--accent)",
              fontSize: 12.5,
              textDecoration: "none",
            }}
          >
            Get Ollama <I.External style={{ width: 12, height: 12 }} />
          </a>
        </div>
      )}
    </div>
  );
}
