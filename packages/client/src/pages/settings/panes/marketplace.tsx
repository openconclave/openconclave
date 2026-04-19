import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Section } from "../atoms";

interface MarketplaceEntry {
  id: string;
  title: string;
  description: string;
  toolName?: string;
  tags?: string[];
  requires?: { providers?: string[]; embeddings?: boolean };
  definitionUrl: string;
  imageUrl: string | null;
}

interface IndexResponse {
  entries: MarketplaceEntry[];
  fetchedAt: number;
  error: string | null;
}

interface InstalledConclave {
  id: number;
  name: string;
  toolName?: string | null;
}

export function MarketplacePane() {
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledConclave[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const [idx, conclaves] = await Promise.all([
        api.get<IndexResponse>("/starters"),
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
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Marketplace</h1>
          <p>Browse community conclaves from the official directory. Install one with a click — it becomes a tool you can call from Claude Code and run from the editor.</p>
        </div>
        <div>
          <button type="button" className="btn btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <Section title="Browse">
        <input
          type="text"
          className="settings-input"
          placeholder="Search by title, description, or tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Section>

      {loadError && (
        <div className="mp-error">
          Couldn't reach the marketplace: {loadError}
        </div>
      )}

      {filtered === null ? (
        <div className="settings-empty"><div>Loading…</div></div>
      ) : filtered.length === 0 ? (
        <div className="settings-empty">
          <div>{query ? "No matches." : "No conclaves available."}</div>
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
                    <a className="btn btn-ghost" href={`/conclaves/${installedId}`}>
                      Open →
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
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
    </div>
  );
}
