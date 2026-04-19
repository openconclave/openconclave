import { useState } from "react";
import { api } from "@/lib/api";
import { Pill } from "../../atoms";
import type { WebSearchProviderId } from "./providers";

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  sampleTitles?: string[];
  engines?: string[];
  error?: string;
  warn?: string;
}

export function TestButton({
  provider,
  url,
  apiKey,
  disabled,
}: {
  provider: WebSearchProviderId;
  url: string;
  apiKey: string;
  disabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<TestResult | null>(null);

  const run = async () => {
    setState("running");
    setResult(null);
    try {
      const res = await api.post<TestResult>("/settings/web-search/test", {
        provider,
        url: url || undefined,
        apiKey: apiKey || undefined,
      });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Request failed" });
    }
    setState("done");
  };

  return (
    <div className="ws-test">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={run}
        disabled={disabled || state === "running"}
      >
        {state === "running" ? "Testing…" : "Test connection"}
      </button>
      {result && (
        <div className={`ws-test-result ${result.ok ? (result.warn ? "warn" : "ok") : "err"}`}>
          {result.ok ? (
            <>
              <Pill tone={result.warn ? "warn" : "ok"}>
                {result.warn ? "Reachable" : "Connected"}
              </Pill>
              <span className="ws-test-meta">
                {result.latencyMs}ms
                {result.engines && result.engines.length > 0 && (
                  <> · {result.engines.slice(0, 3).join(", ")}</>
                )}
              </span>
              {result.warn && <span className="ws-test-meta warn-text">{result.warn}</span>}
              {result.sampleTitles && result.sampleTitles.length > 0 && (
                <ul className="ws-test-samples">
                  {result.sampleTitles.slice(0, 3).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <Pill tone="err">Failed</Pill>
              <span className="ws-test-meta">{result.error ?? "Unknown error"}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
