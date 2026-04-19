import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface UpdateStatus {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  channel: string;
  releasedAt: string | null;
  notesUrl: string | null;
  downloadUrl: string | null;
  checkedAt: string;
  error: string | null;
}

const DISMISS_KEY = "oc:update-dismissed-version";

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(
    () => localStorage.getItem(DISMISS_KEY),
  );
  const [showHow, setShowHow] = useState(false);

  useEffect(() => {
    api.get<UpdateStatus>("/update/status").then(setStatus).catch(() => {});
  }, []);

  if (!status || !status.hasUpdate || !status.latest) return null;
  if (dismissed === status.latest) return null;

  const href = status.notesUrl ?? status.downloadUrl ?? "https://openconclave.com";

  const onDismiss = () => {
    if (status.latest) {
      localStorage.setItem(DISMISS_KEY, status.latest);
      setDismissed(status.latest);
    }
  };

  return (
    <div className="update-banner">
      <div className="update-banner-main">
        <div className="update-banner-text">
          <strong>Update available — v{status.latest}</strong>
          <span className="update-banner-sub">
            You're on v{status.current}
            {status.releasedAt ? ` · released ${formatDate(status.releasedAt)}` : ""}
          </span>
        </div>
        <div className="update-banner-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowHow((v) => !v)}>
            {showHow ? "Hide" : "How to update"}
          </button>
          <a className="btn btn-ghost" href={href} target="_blank" rel="noreferrer">
            View release →
          </a>
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
      {showHow && <UpdateHow />}
    </div>
  );
}

function UpdateHow() {
  return (
    <div className="update-banner-how">
      <p>
        Stop OC, then run this in a terminal:
      </p>
      <pre className="inline-cmd">oc update</pre>
      <p className="update-banner-hint">
        OC will download the new binary and swap it in place. Start OC again after it finishes.
        If OC was installed system-wide (e.g. Program Files), run the terminal as Administrator.
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
