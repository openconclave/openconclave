import { I, TopologyPreview } from "../atoms";

export type OnboardingPath = "cc" | "visual";

export function WelcomeStep({
  path,
  setPath,
}: {
  path: OnboardingPath;
  setPath: (p: OnboardingPath) => void;
}) {
  return (
    <div className="ob-page">
      <div className="ob-eyebrow">Welcome</div>
      <h1 className="ob-h1">Where one agent isn&rsquo;t enough.</h1>
      <p className="ob-lede">
        OpenConclave runs multiple AI agents together — in pipelines, debates, and teams.
        Everything stays on your machine. This takes about <strong style={{ color: "var(--text)" }}>two minutes</strong>.
      </p>

      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 28px" }}>
        <TopologyPreview />
      </div>

      <h2 className="ob-h2" style={{ marginBottom: 6 }}>How would you like to drive it?</h2>
      <p className="dim" style={{ fontSize: 13, marginBottom: 16 }}>
        You can change this later. It just decides what we set up first.
      </p>

      <div className="path-grid">
        <button
          className={`path ${path === "cc" ? "selected" : ""}`}
          onClick={() => setPath("cc")}
          type="button"
        >
          <div className="path-tag">RECOMMENDED</div>
          <div className="path-ico"><I.Terminal style={{ width: 18, height: 18 }} /></div>
          <div className="path-title">From Claude Code</div>
          <div className="path-desc">
            Describe pipelines in natural language. Claude Code builds, triggers, and answers agent prompts via MCP.
          </div>
        </button>
        <button
          className={`path ${path === "visual" ? "selected" : ""}`}
          onClick={() => setPath("visual")}
          type="button"
        >
          <div className="path-tag">&nbsp;</div>
          <div className="path-ico"><I.Bolt style={{ width: 18, height: 18 }} /></div>
          <div className="path-title">Just the visual editor</div>
          <div className="path-desc">
            Drag nodes, wire them up, write prompts. You&rsquo;ll skip the Claude Code integration.
          </div>
        </button>
      </div>
    </div>
  );
}
