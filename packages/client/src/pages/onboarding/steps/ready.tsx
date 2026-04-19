import { I, type Starter, type StarterId } from "../atoms";
import type { ProviderInfo } from "./provider";
import type { OllamaState } from "./ollama";

export function ReadyStep({
  providers,
  ollama,
  starter,
  starters,
  finishing,
  onFinish,
}: {
  providers: ProviderInfo[];
  ollama: OllamaState;
  starter: StarterId;
  starters: Starter[];
  finishing: boolean;
  onFinish: () => void;
}) {
  const starterObj = starters.find((s) => s.id === starter);

  return (
    <div className="ob-page">
      <div className="success-hero">
        <div className="success-badge">
          <I.Spark style={{ width: 28, height: 28, color: "var(--accent)" }} />
          <div className="check"><I.Check style={{ width: 12, height: 12 }} /></div>
        </div>
        <div className="ob-eyebrow" style={{ textAlign: "center" }}>You&rsquo;re all set</div>
        <h1 className="ob-h1" style={{ textAlign: "center" }}>OpenConclave is ready.</h1>
        <p className="ob-lede" style={{ margin: "8px auto 0", textAlign: "center" }}>
          Here&rsquo;s what we set up, and what to do next.
        </p>
      </div>

      <div className="ds-grid-3" style={{ marginBottom: 24 }}>
        <div className="ds-card quiet" style={{ padding: 14 }}>
          <div className="uppercase-label" style={{ marginBottom: 6 }}>Providers</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{providers.length}</div>
          <div className="dim" style={{ fontSize: 11.5 }}>
            {providers.map((p) => p.name).join(" · ") || "—"}
          </div>
        </div>
        <div className="ds-card quiet" style={{ padding: 14 }}>
          <div className="uppercase-label" style={{ marginBottom: 6 }}>Local models</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            {ollama.status === "online" ? ollama.models.length : 0}
          </div>
          <div className="dim" style={{ fontSize: 11.5 }}>
            {ollama.status === "online" ? "Ollama connected" : "Ollama not installed"}
          </div>
        </div>
        <div className="ds-card quiet" style={{ padding: 14 }}>
          <div className="uppercase-label" style={{ marginBottom: 6 }}>First conclave</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{starterObj?.nodes ? 1 : 0}</div>
          <div className="dim" style={{ fontSize: 11.5 }}>{starterObj?.title ?? "—"}</div>
        </div>
      </div>

      <p className="uppercase-label" style={{ marginBottom: 10 }}>Do next</p>
      <div className="next-list">
        <button className="next" onClick={onFinish} type="button" disabled={finishing}>
          <div className="next-ico"><I.Play style={{ width: 14, height: 14 }} /></div>
          <div className="next-main">
            <div className="nt">
              {finishing ? "Opening dashboard…" : `Go to dashboard`}
            </div>
            <div className="ns">
              {starterObj?.nodes
                ? `Run ${starterObj.title} or any starter from the conclaves list.`
                : "Jump in and start building."}
            </div>
          </div>
          <div className="next-arrow">
            {finishing ? <I.Loader style={{ width: 16, height: 16 }} /> : <I.Chevron style={{ width: 16, height: 16 }} />}
          </div>
        </button>
        <div className="next">
          <div className="next-ico"><I.Book /></div>
          <div className="next-main">
            <div className="nt">Upload a knowledge base</div>
            <div className="ns">Agents can search your docs during runs — and write back lessons learned.</div>
          </div>
          <div className="next-arrow"><I.Chevron style={{ width: 16, height: 16 }} /></div>
        </div>
        <div className="next">
          <div className="next-ico"><I.Plus /></div>
          <div className="next-main">
            <div className="nt">Build your own conclave from scratch</div>
            <div className="ns">Open the visual editor — drag nodes, draw edges, write prompts.</div>
          </div>
          <div className="next-arrow"><I.Chevron style={{ width: 16, height: 16 }} /></div>
        </div>
        <div className="next">
          <div className="next-ico"><I.Terminal /></div>
          <div className="next-main">
            <div className="nt">Trigger conclaves from Claude Code</div>
            <div className="ns">
              Every conclave is exposed as an MCP tool. Try:{" "}
              <span className="mono" style={{ color: "var(--accent)" }}>claude &quot;run the ledger on …&quot;</span>
            </div>
          </div>
          <div className="next-arrow"><I.Chevron style={{ width: 16, height: 16 }} /></div>
        </div>
      </div>
    </div>
  );
}
