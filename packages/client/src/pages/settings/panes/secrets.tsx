import { Section } from "../atoms";

const SECRET_KEY_PREFIXES = ["telegram_", "web_search_tavily_", "web_search_serper_", "web_search_linkup_"];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PREFIXES.some((p) => key.startsWith(p));
}

export function SecretsPane({ values }: { values: Record<string, string> }) {
  const secrets = Object.entries(values)
    .filter(([k, v]) => isSecretKey(k) && v)
    .map(([k]) => k)
    .sort();

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Secrets vault</h1>
          <p>Credentials stored locally in your OpenConclave settings. Edit them in their respective panes — this view is read-only.</p>
        </div>
      </div>

      <Section title="Stored secrets" sub={`${secrets.length} configured`}>
        {secrets.length === 0 ? (
          <div className="settings-empty">
            <div>No secrets stored. Connect a provider or integration to add credentials.</div>
          </div>
        ) : (
          <div className="secrets-list">
            {secrets.map((key) => (
              <div key={key} className="secrets-row">
                <code>{key}</code>
                <span className="secrets-row-mask">••••••••</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
