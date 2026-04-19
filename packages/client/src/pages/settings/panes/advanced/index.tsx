import { Section } from "../../atoms";

export function AdvancedPane() {
  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Advanced</h1>
          <p>Less-frequent controls. Handle with care.</p>
        </div>
      </div>

      <Section title="Setup wizard" sub="Re-run onboarding to reconfigure providers and Ollama">
        <div className="advanced-row">
          <div className="advanced-row-text">
            The wizard walks through connecting an AI provider, choosing a starter conclave, and running your first conclave.
          </div>
          <a href="/?onboarding" className="btn btn-secondary">Run wizard</a>
        </div>
      </Section>
    </div>
  );
}
