import { Section } from "../../atoms";
import { WEB_SEARCH_PROVIDERS, keyFor, type WebSearchProviderId } from "./providers";
import { ProviderPicker } from "./provider-picker";
import { SearxngConfig } from "./searxng-config";
import { ApiKeyConfig } from "./api-key-config";
import { TestButton } from "./test-button";

const DEFAULT_SEARXNG_URL = "http://localhost:8080";

export function WebSearchPane({
  values,
  setValue,
}: {
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
}) {
  const provider = (values.web_search_provider as WebSearchProviderId) || "none";
  const info = WEB_SEARCH_PROVIDERS.find((p) => p.id === provider);
  const credKey = keyFor(provider);
  const credValue = credKey ? (values[credKey] ?? "") : "";

  const handleProvider = (id: WebSearchProviderId) => {
    setValue("web_search_provider", id);
    // When switching to SearXNG for the first time, pre-fill the localhost default
    // so a naive save actually persists a usable credential. Users almost always
    // want localhost:8080 — custom endpoints are the exception.
    if (id === "searxng" && !values.web_search_searxng_url) {
      setValue("web_search_searxng_url", DEFAULT_SEARXNG_URL);
    }
  };
  const handleCred = (v: string) => {
    if (credKey) setValue(credKey, v);
  };

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Web search</h1>
          <p>
            Give your agents the ability to search the web. Pick a provider and configure it once — the{" "}
            <code>WebSearch</code> tool becomes available to every agent node.
          </p>
        </div>
      </div>

      <Section title="Provider" sub="One active at a time">
        <ProviderPicker value={provider} onChange={handleProvider} />
      </Section>

      {info && info.credential !== "none" && (
        <Section title={info.name} sub={info.tagline}>
          {info.credential === "url" && <SearxngConfig url={credValue} onUrlChange={handleCred} />}
          {info.credential === "key" && (
            <ApiKeyConfig provider={info} value={credValue} onChange={handleCred} />
          )}
          {!credValue && (
            <div className="settings-warn">
              {info.credential === "url"
                ? "Enter an instance URL before saving."
                : "Paste your API key before saving."}
            </div>
          )}
          <div className="settings-section-foot">
            <TestButton
              provider={provider}
              url={info.credential === "url" ? credValue : ""}
              apiKey={info.credential === "key" ? credValue : ""}
              disabled={!credValue}
            />
          </div>
        </Section>
      )}

      {provider === "none" && (
        <div className="settings-info">
          Web search is disabled. Agents will not see the <code>WebSearch</code> tool.
        </div>
      )}
    </div>
  );
}
