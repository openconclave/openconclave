import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FieldRow, Pill } from "../../atoms";
import { SearxngAdvanced } from "./searxng-advanced";

interface ManagerStatus {
  docker: "missing" | "daemon-down" | "ready";
  container: "not-found" | "stopped" | "running";
  healthy: boolean;
  port: number;
}

const POLL_INTERVAL_MS = 5000;

export function SearxngConfig({
  url,
  onUrlChange,
}: {
  url: string;
  onUrlChange: (v: string) => void;
}) {
  const [status, setStatus] = useState<ManagerStatus | null>(null);
  const [working, setWorking] = useState<"start" | "stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<ManagerStatus>("/settings/web-search/searxng/status");
      setStatus(s);
    } catch {
      // Network hiccup — keep last-known status
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (action: "start" | "stop" | "restart") => {
    setWorking(action);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(`/settings/web-search/searxng/${action}`, {});
      if (!res.ok) setError(res.error ?? `${action} failed`);
      await refresh();
      if (action === "start" && res.ok) {
        // Backend just wrote web_search_searxng_url — sync it into the draft values too.
        onUrlChange(`http://localhost:${status?.port ?? 8080}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setWorking(null);
  };

  return (
    <>
      <ManagedPanel status={status} working={working} error={error} onAction={run} />

      <div className="advanced-expander">
        <button type="button" className="advanced-expander-head" onClick={() => setShowAdvanced((s) => !s)}>
          <span className="chev">{showAdvanced ? "▾" : "▸"}</span>
          Advanced — custom instance or manual setup
        </button>
        {showAdvanced && (
          <div className="advanced-expander-body">
            <FieldRow label="Instance URL" help="Override if you run SearXNG somewhere other than localhost:8080.">
              <input
                className="settings-input mono"
                placeholder="http://localhost:8080"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
              />
            </FieldRow>
            <SearxngAdvanced />
          </div>
        )}
      </div>
    </>
  );
}

function ManagedPanel({
  status,
  working,
  error,
  onAction,
}: {
  status: ManagerStatus | null;
  working: "start" | "stop" | "restart" | null;
  error: string | null;
  onAction: (a: "start" | "stop" | "restart") => void;
}) {
  if (!status) {
    return <div className="managed-panel loading">Checking Docker…</div>;
  }

  if (status.docker === "missing") {
    return (
      <div className="managed-panel warn">
        <div className="managed-title">Docker not detected</div>
        <div className="managed-body">
          SearXNG runs in a Docker container. Install Docker Desktop, then refresh this page.
        </div>
        <a className="btn btn-primary" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer">
          Install Docker Desktop →
        </a>
      </div>
    );
  }

  if (status.docker === "daemon-down") {
    return (
      <div className="managed-panel warn">
        <div className="managed-title">Docker Desktop is not running</div>
        <div className="managed-body">Start Docker Desktop, then click Retry.</div>
        <button type="button" className="btn btn-secondary" onClick={() => onAction("start")} disabled={!!working}>
          Retry
        </button>
      </div>
    );
  }

  if (status.container === "running" && status.healthy) {
    return (
      <div className="managed-panel ok">
        <div className="managed-head">
          <Pill tone="ok">Running</Pill>
          <span className="managed-endpoint">localhost:{status.port}</span>
        </div>
        {error && <div className="managed-error">{error}</div>}
        <div className="managed-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onAction("restart")} disabled={!!working}>
            {working === "restart" ? "Restarting…" : "Restart"}
          </button>
          <button type="button" className="btn btn-ghost danger" onClick={() => onAction("stop")} disabled={!!working}>
            {working === "stop" ? "Stopping…" : "Stop"}
          </button>
        </div>
      </div>
    );
  }

  if (status.container === "running" && !status.healthy) {
    return (
      <div className="managed-panel warn">
        <div className="managed-head">
          <Pill tone="warn">Unhealthy</Pill>
          <span className="managed-endpoint">localhost:{status.port}</span>
        </div>
        <div className="managed-body">The container is running but not answering. It may still be starting up.</div>
        <div className="managed-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onAction("restart")} disabled={!!working}>
            {working === "restart" ? "Restarting…" : "Restart"}
          </button>
        </div>
      </div>
    );
  }

  // container = stopped or not-found → one-click start
  return (
    <div className="managed-panel">
      <div className="managed-head">
        <Pill tone="neutral">Not running</Pill>
      </div>
      <div className="managed-body">
        One click creates a SearXNG container at <code>localhost:{status.port}</code> with JSON output enabled.
      </div>
      {error && <div className="managed-error">{error}</div>}
      <div className="managed-actions">
        <button type="button" className="btn btn-primary" onClick={() => onAction("start")} disabled={!!working}>
          {working === "start" ? "Starting…" : "Start SearXNG"}
        </button>
      </div>
    </div>
  );
}
