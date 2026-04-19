import { WEB_SEARCH_PROVIDERS, type WebSearchProviderId } from "./providers";

export function ProviderPicker({
  value,
  onChange,
}: {
  value: WebSearchProviderId;
  onChange: (id: WebSearchProviderId) => void;
}) {
  return (
    <div className="ws-picker">
      {WEB_SEARCH_PROVIDERS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`ws-card ${active ? "active" : ""} ${p.id === "none" ? "none" : ""}`}
            onClick={() => onChange(p.id)}
          >
            <div className="ws-card-head">
              <span className="ws-card-name">{p.name}</span>
              {p.recommended && <span className="ws-card-rec">Recommended</span>}
            </div>
            <div className="ws-card-tag">{p.tagline}</div>
            {p.free && <div className="ws-card-free">{p.free}</div>}
            <div className={`ws-card-radio ${active ? "on" : ""}`} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
