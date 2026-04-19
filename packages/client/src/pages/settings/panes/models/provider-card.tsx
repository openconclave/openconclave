import { useState } from "react";
import { api } from "@/lib/api";
import { Pill } from "../../atoms";
import type { ProviderInfo } from "./types";

export function ProviderCard({
  provider,
  onEdit,
  onDelete,
}: {
  provider: ProviderInfo;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const data = await api.get<{ models: string[] }>(`/providers/${provider.id}/models`);
      const count = data.models?.length ?? 0;
      setTestMsg({ ok: true, text: count > 0 ? `${count} models available` : "Connected but no models found" });
    } catch (err) {
      setTestMsg({ ok: false, text: err instanceof Error ? err.message : "Connection failed" });
    }
    setTesting(false);
  };

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <div className="provider-card-id">
          <span className="name">{provider.name}</span>
          <Pill tone="neutral">{provider.apiType === "responses" ? "Responses" : "Chat"}</Pill>
        </div>
        <div className="provider-card-actions">
          <button type="button" className="btn btn-secondary" onClick={runTest} disabled={testing}>
            {testing ? "Testing…" : "Test"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onEdit}>Edit</button>
          <button type="button" className="btn btn-ghost danger" onClick={onDelete}>Remove</button>
        </div>
      </div>
      <div className="provider-card-endpoint">{provider.baseUrl}</div>
      {testMsg && (
        <div className={`provider-card-test ${testMsg.ok ? "ok" : "err"}`}>{testMsg.text}</div>
      )}
    </div>
  );
}
