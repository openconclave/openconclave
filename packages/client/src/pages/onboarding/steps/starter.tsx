import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface MarketplaceEntry {
  id: string;
  title: string;
  description: string;
  toolName?: string;
  tags?: string[];
  requires?: { providers?: string[]; embeddings?: boolean };
  definitionUrl?: string;
  imageUrl?: string | null;
}

interface InstalledConclave {
  id: number;
  name: string;
  toolName?: string | null;
}

export function StarterStep() {
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [installed, setInstalled] = useState<InstalledConclave[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [idx, conclaves] = await Promise.all([
        api.get<{ entries: MarketplaceEntry[]; error: string | null }>("/starters"),
        api.get<InstalledConclave[]>("/conclaves"),
      ]);
      setEntries(idx.entries);
      setLoadError(idx.error);
      setInstalled(Array.isArray(conclaves) ? conclaves : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = `${e.title} ${e.description} ${(e.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  const installedByTool = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of installed) {
      if (c.toolName) map.set(c.toolName, c.id);
    }
    return map;
  }, [installed]);

  const install = async (entry: MarketplaceEntry) => {
    setBusyId(entry.id);
    try {
      const res = await api.post<{ ok: boolean; id?: number; error?: string }>(
        `/starters/${encodeURIComponent(entry.id)}/import`,
        {},
      );
      if (res.ok) {
        toast(`Installed "${entry.title}"`, "success");
        await load();
      } else {
        toast(res.error ?? "Install failed", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
    setBusyId(null);
  };

  return (
    <div className="ob-page wide">
      <div className="ob-eyebrow">Step 04 · First conclave</div>
      <h1 className="ob-h1">Pick something to run first</h1>
      <p className="ob-lede">
        Install a starter from the marketplace, or skip this step and build from scratch. You can swap providers or tweak prompts anytime — installation is reversible.
      </p>

      <div style={{ margin: "16px 0 20px" }}>
        <input
          type="text"
          className="settings-input"
          placeholder="Search by title, description, or tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loadError && (
        <div className="mp-error" style={{ marginBottom: 16 }}>
          Couldn't reach the marketplace: {loadError}
        </div>
      )}

      {filtered === null ? (
        <div style={{ color: "var(--text-faint)", padding: "32px 0" }}>Loading marketplace…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "var(--text-faint)", padding: "32px 0" }}>
          {query ? "No matches." : "No conclaves available."}
        </div>
      ) : (
        <div className="mp-grid">
          {filtered.map((entry) => {
            const installedId = entry.toolName ? installedByTool.get(entry.toolName) : undefined;
            const isInstalled = installedId !== undefined;
            const needs = entry.requires;
            return (
              <div key={entry.id} className="mp-card">
                {entry.imageUrl && (
                  <div className="mp-card-image">
                    <img src={entry.imageUrl} alt={entry.title} loading="lazy" />
                  </div>
                )}
                <div className="mp-card-head">
                  <div className="mp-card-title">{entry.title}</div>
                  {isInstalled && <span className="mp-badge ok">Installed</span>}
                </div>
                <p className="mp-card-desc">{entry.description}</p>
                {(entry.tags?.length || needs) && (
                  <div className="mp-card-meta">
                    {entry.tags?.map((t) => (
                      <span key={t} className="mp-tag">#{t}</span>
                    ))}
                    {needs?.providers?.includes("anthropic") && (
                      <span className="mp-req">requires Anthropic</span>
                    )}
                    {needs?.embeddings && (
                      <span className="mp-req">requires embeddings</span>
                    )}
                  </div>
                )}
                <div className="mp-card-actions">
                  {isInstalled ? (
                    <a className="ds-btn ds-btn-ghost" href={`/conclaves/${installedId}`}>
                      Open →
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary"
                      onClick={() => install(entry)}
                      disabled={busyId === entry.id}
                    >
                      {busyId === entry.id ? "Installing…" : "Install"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ds-card quiet" style={{ marginTop: 20 }}>
        <div className="ds-card-sub" style={{ fontSize: 12.5 }}>
          <strong style={{ color: "var(--text)" }}>Note:</strong> every installed conclave exposes itself as an MCP tool.
          Claude Code, Cursor, and other MCP clients can call it by its tool name.
        </div>
      </div>
    </div>
  );
}
