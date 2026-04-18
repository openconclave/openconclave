import { useState } from "react";
import { I } from "../atoms";

export type ClaudeStatus = "checking" | "installed" | "not_found";

export function ClaudeCodeStep({
  status,
  version,
  onRecheck,
}: {
  status: ClaudeStatus;
  version: string | null;
  onRecheck: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const installCmd = "npm install -g @anthropic-ai/claude-code";

  const copy = () => {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => console.error("clipboard:", err));
  };

  return (
    <div className="ob-page">
      <div className="ob-eyebrow">Step 01 · Claude Code</div>
      <h1 className="ob-h1">Connect to Claude Code</h1>
      <p className="ob-lede">
        Claude Code is Anthropic&rsquo;s CLI that connects to OpenConclave via MCP. It&rsquo;s how agents escalate
        ambiguous decisions without interrupting you on every step.
      </p>

      <div className="ds-card" style={{ marginBottom: 14 }}>
        {status === "installed" ? (
          <>
            <div className="ds-card-row">
              <div className="hc-ico ok" style={{ width: 28, height: 28 }}>
                <I.Check style={{ width: 14, height: 14 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="ds-card-title">Claude Code detected</div>
                <div className="ds-card-sub mono" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {version ?? "installed"}
                </div>
              </div>
              <button className="ds-btn ds-btn-ghost" onClick={onRecheck} style={{ fontSize: 12 }}>
                Re-check
              </button>
            </div>
            <div className="sep" />
            <div
              className="mono"
              style={{
                background: "var(--bg-2)",
                padding: "10px 12px",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--ok)",
                border: "1px solid oklch(0.45 0.1 150 / 0.3)",
              }}
            >
              ✓ Plugins <span className="faint">openconclave-channel</span> and{" "}
              <span className="faint">openconclave-dev</span> loaded.
              Conclave channel loops will reach your terminal.
            </div>
          </>
        ) : status === "checking" ? (
          <div className="ds-card-row">
            <div className="hc-ico run" style={{ width: 28, height: 28 }}>
              <I.Loader style={{ width: 14, height: 14 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="ds-card-title">Checking for Claude Code…</div>
              <div className="ds-card-sub">Looking for the <span className="mono">claude</span> CLI on your PATH.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="ds-card-row">
              <div className="hc-ico err" style={{ width: 28, height: 28 }}>
                <I.X style={{ width: 14, height: 14 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="ds-card-title">Claude Code not found</div>
                <div className="ds-card-sub">
                  We couldn&rsquo;t find the <span className="mono">claude</span> CLI on your PATH.
                  You can install it now or skip — this is optional.
                </div>
              </div>
            </div>
            <div className="sep" />
            <div className="cmd-row">
              <div className="cmd-box">
                <I.Terminal style={{ width: 13, height: 13, color: "var(--text-faint)", flexShrink: 0 }} />
                <code>{installCmd}</code>
              </div>
              <button
                className={`ds-btn ${copied ? "ds-btn-secondary" : "ds-btn-secondary"}`}
                onClick={copy}
                style={{ color: copied ? "var(--ok)" : undefined }}
              >
                {copied ? <I.Check /> : <I.Copy />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="ds-btn ds-btn-ghost" onClick={onRecheck}>Re-check</button>
            </div>
            <a
              href="https://docs.anthropic.com/en/docs/claude-code/overview"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "var(--accent)",
                marginTop: 10,
                textDecoration: "none",
              }}
            >
              Claude Code documentation <I.External style={{ width: 11, height: 11 }} />
            </a>
          </>
        )}
      </div>

      <h2 className="ob-h2" style={{ marginTop: 24 }}>What you can do with Claude Code + OC</h2>
      <div className="hc-list">
        {[
          ["Create conclaves with natural language", "Describe what you want and Claude builds the nodes, edges, prompts, and all."],
          ["Trigger and monitor runs", "Start conclaves, watch progress, respond to agent questions from your terminal."],
          ["Channel loop prompts", "When an agent gets stuck, Claude answers from context — or asks you in the terminal."],
        ].map(([title, desc]) => (
          <div className="hc" key={title}>
            <div className="hc-ico">
              <I.Chevron style={{ width: 12, height: 12 }} />
            </div>
            <div className="hc-main">
              <div className="name">{title}</div>
              <div className="meta" style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-dim)" }}>
                {desc}
              </div>
            </div>
            <div />
          </div>
        ))}
      </div>
    </div>
  );
}
