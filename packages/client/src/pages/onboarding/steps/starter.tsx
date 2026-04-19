import { StarterViz, type Starter, type StarterId } from "../atoms";

export function StarterStep({
  starter,
  setStarter,
  starters,
  hasAnthropic,
  hasEmbed,
}: {
  starter: StarterId;
  setStarter: (s: StarterId) => void;
  starters: Starter[];
  hasAnthropic: boolean;
  hasEmbed: boolean;
}) {
  const current = starters.find((s) => s.id === starter);

  return (
    <div className="ob-page wide">
      <div className="ob-eyebrow">Step 04 · First conclave</div>
      <h1 className="ob-h1">Pick something to run first</h1>
      <p className="ob-lede">
        A good first conclave is one you can actually use. Pick a starter and we&rsquo;ll import it — you can swap
        providers or tweak the prompts before the first run.
      </p>

      <div className="starter-grid">
        {starters.map((s) => {
          const needsOk = s.needs.every((n) => (n === "anthropic" ? hasAnthropic : hasEmbed));
          const selected = starter === s.id;
          return (
            <button
              key={s.id}
              className={`starter ${selected ? "selected" : ""} ${needsOk ? "" : "disabled"}`}
              onClick={() => needsOk && setStarter(s.id)}
              type="button"
              disabled={!needsOk}
            >
              <div className="starter-viz"><StarterViz kind={s.viz} /></div>
              <div className="starter-body">
                <div className="starter-title">{s.title}</div>
                <div className="starter-desc">{s.desc}</div>
                <div className="starter-meta">
                  <span className="ds-pill mono">{s.nodes > 0 ? `${s.nodes} nodes` : "blank"}</span>
                  {s.needs.map((n) => {
                    const good = n === "anthropic" ? hasAnthropic : hasEmbed;
                    return (
                      <span key={n} className={`ds-pill ${good ? "ok" : "danger"}`}>
                        {good ? "✓" : "!"} {n === "anthropic" ? "Anthropic" : "embeddings"}
                      </span>
                    );
                  })}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="ds-card quiet" style={{ marginTop: 16 }}>
        <div className="ds-card-sub" style={{ fontSize: 12.5 }}>
          <strong style={{ color: "var(--text)" }}>Note:</strong> every conclave exposes itself as an MCP tool once imported.
          Claude Code, Cursor, and other MCP clients can call it as{" "}
          <span className="mono" style={{ color: "var(--accent)" }}>{current?.toolName ?? "your_tool_name"}()</span>.
        </div>
      </div>
    </div>
  );
}
