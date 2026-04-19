import { useEffect, useRef, useState } from "react";
import { I, type Starter, type StarterId } from "../atoms";

type Phase = "idle" | "running" | "channel" | "done";

interface LogLine {
  t: string;
  tag: string;
  cls: "trig" | "agn" | "cod" | "out";
  msg: string;
  channel?: boolean;
}

type ScriptKind = "ledger" | "review" | "advisors";

const SCRIPTS: Record<ScriptKind, LogLine[]> = {
  ledger: [
    { t: "00:00", tag: "trig", cls: "trig", msg: "chat trigger fired" },
    { t: "00:01", tag: "discussion", cls: "agn", msg: "round 1/6 · sunk-cost agent starts" },
    { t: "00:04", tag: "sunk-cost", cls: "agn", msg: "+ 3 items: savings, founder identity, promises to family" },
    { t: "00:07", tag: "opportunity", cls: "agn", msg: "+ 3 items: time with kids, steady income, different mentors" },
    { t: "00:11", tag: "moderator", cls: "agn", msg: "enforcing alternation · round 2/6" },
    { t: "00:14", tag: "sunk-cost", cls: "agn", msg: "+ 2 items: sunk years, cofounder relationship" },
    { t: "00:18", tag: "channel", cls: "cod", msg: "⏸  agent needs clarification", channel: true },
  ],
  review: [
    { t: "00:00", tag: "trig", cls: "trig", msg: "run triggered on session.ts" },
    { t: "00:02", tag: "context", cls: "agn", msg: "context reader · scanning imports + callsites" },
    { t: "00:05", tag: "correctness", cls: "agn", msg: "specialist running (parallel)" },
    { t: "00:05", tag: "security", cls: "agn", msg: "specialist running (parallel)" },
    { t: "00:05", tag: "tests", cls: "agn", msg: "specialist running (parallel)" },
    { t: "00:11", tag: "security", cls: "agn", msg: "flagged: sliding window resets on every request" },
    { t: "00:14", tag: "channel", cls: "cod", msg: "⏸  agent needs clarification", channel: true },
  ],
  advisors: [
    { t: "00:00", tag: "trig", cls: "trig", msg: "trigger fired" },
    { t: "00:03", tag: "pragmatist", cls: "agn", msg: "answering independently" },
    { t: "00:03", tag: "contrarian", cls: "agn", msg: "answering independently" },
    { t: "00:03", tag: "strategist", cls: "agn", msg: "answering independently" },
    { t: "00:09", tag: "synthesizer", cls: "agn", msg: "merging perspectives" },
    { t: "00:12", tag: "channel", cls: "cod", msg: "⏸  agent needs clarification", channel: true },
  ],
};

const DEFAULT_PROMPTS: Record<ScriptKind, string> = {
  ledger: "I'm considering leaving the startup I co-founded three years ago. I've put in savings, late nights, and told my family this would work. Another company offered me a role that gives me more time and better pay, but feels less meaningful.",
  review: "Review src/auth/session.ts — I just refactored token refresh to use a sliding window, want a second look.",
  advisors: "Should we prioritize migrating to Postgres now, or ship the feature backlog first?",
};

const CHANNEL_QUESTIONS: Record<ScriptKind, string> = {
  ledger: 'Is the "other company" offer a concrete offer with compensation terms, or exploratory?',
  review: "Is the session storage server-side only, or does it sync to client cookies?",
  advisors: "Is your current Postgres need driven by reliability or feature gaps?",
};

function scriptKindFor(id: StarterId): ScriptKind {
  if (id.includes("ledger")) return "ledger";
  if (id.includes("review")) return "review";
  if (id.includes("advisor")) return "advisors";
  return "ledger";
}

export function FirstRunStep({
  starter,
  starters,
  onComplete,
}: {
  starter: StarterId;
  starters: Starter[];
  onComplete: () => void;
}) {
  const effective = scriptKindFor(starter);
  const starterMeta = starters.find((s) => s.id === starter);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompt, setPrompt] = useState<string>(DEFAULT_PROMPTS[effective]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [channelOpen, setChannelOpen] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    return () => {
      timers.current.forEach((id) => clearTimeout(id));
      timers.current = [];
    };
  }, []);

  const start = () => {
    setPhase("running");
    setLog([]);
    const script = SCRIPTS[effective];
    script.forEach((line, i) => {
      const id = window.setTimeout(() => {
        setLog((prev) => [...prev, line]);
        if (line.channel) {
          setPhase("channel");
          setChannelOpen(true);
        }
      }, 500 + i * 700);
      timers.current.push(id);
    });
  };

  const answer = () => {
    setChannelOpen(false);
    setLog((prev) => [
      ...prev,
      { t: "00:22", tag: "channel", cls: "cod", msg: "↩ answered via Claude Code" },
      { t: "00:28", tag: "output", cls: "out", msg: "✓ complete · run artifacts written to ~/.oc/runs/" },
    ]);
    window.setTimeout(() => setPhase("done"), 600);
  };

  const channelAgent =
    effective === "ledger" ? "moderator" : effective === "review" ? "security" : "synthesizer";

  return (
    <div className="ob-page wide">
      <div className="ob-eyebrow">Step 05 · First run</div>
      <h1 className="ob-h1">Let&rsquo;s run it together</h1>
      <p className="ob-lede">
        Watch a full run end-to-end. This includes a <strong style={{ color: "var(--text)" }}>channel loop</strong> —
        an agent stopping to ask a question — which is the single most important concept to see in action.
      </p>

      <div className="ds-field">
        <label>Describe your input</label>
        <textarea
          className="chat-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          disabled={phase !== "idle"}
        />
      </div>

      {phase === "idle" && (
        <button
          className="ds-btn ds-btn-primary"
          onClick={start}
          style={{ width: "100%", justifyContent: "center" }}
        >
          <I.Play style={{ width: 12, height: 12 }} /> Start run
        </button>
      )}

      {phase !== "idle" && (
        <div className="run-panel">
          <div className="run-head">
            <span className="pinger" />
            <span className="mono" style={{ fontSize: 12 }}>run · {starterMeta?.toolName}</span>
            <div className="sp" />
            {phase === "running" && <span className="ds-pill warn"><span className="ds-dot" /> running</span>}
            {phase === "channel" && <span className="ds-pill warn"><span className="ds-dot" /> waiting on you</span>}
            {phase === "done" && <span className="ds-pill ok"><I.Check style={{ width: 10, height: 10 }} /> complete</span>}
          </div>
          <div className="run-body">
            <div className="run-log" ref={logRef}>
              {log.map((l, i) => (
                <div className="line" key={i}>
                  <span className="t">{l.t}</span>
                  <span className={`tag ${l.cls}`}>{l.tag}</span>
                  <span className="msg">{l.msg}</span>
                </div>
              ))}
              {phase === "running" && (
                <div className="line">
                  <span className="t">·</span>
                  <span className="tag dim">...</span>
                  <span><I.Loader style={{ width: 11, height: 11, color: "var(--text-faint)" }} /></span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {channelOpen && (
        <div
          className="ds-card"
          style={{
            marginTop: 14,
            borderColor: "oklch(0.55 0.12 55 / 0.5)",
            background: "linear-gradient(180deg, oklch(0.22 0.05 55 / 0.2), var(--panel))",
          }}
        >
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="hc-ico run" style={{ width: 26, height: 26 }}>
              <I.Terminal style={{ width: 13, height: 13 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="ds-card-title" style={{ fontSize: 13 }}>Channel loop · agent pause</div>
              <div className="ds-card-sub">
                The <span className="mono">{channelAgent}</span> agent asked a question.
                Claude Code answers from context when it can; otherwise it asks you.
              </div>
            </div>
          </div>
          <div className="terminal">
            <div><span className="t-dim">$</span> claude</div>
            <div>
              <span className="t-warn">▶ openconclave-channel</span>{" "}
              <span className="t-dim">· question from {channelAgent}</span>
            </div>
            <div style={{ marginTop: 8 }}>&gt; {CHANNEL_QUESTIONS[effective]}</div>
            <div style={{ marginTop: 8 }} className="t-ok">answered from project context ✓</div>
          </div>
          <button
            className="ds-btn ds-btn-primary"
            style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
            onClick={answer}
          >
            <I.Send style={{ width: 13, height: 13 }} /> Continue run
          </button>
        </div>
      )}

      {phase === "done" && (
        <div
          className="ds-card"
          style={{
            marginTop: 14,
            borderColor: "oklch(0.55 0.12 150 / 0.4)",
            background: "oklch(0.3 0.06 150 / 0.12)",
          }}
        >
          <div className="ds-card-row">
            <div className="hc-ico ok" style={{ width: 28, height: 28 }}>
              <I.Check style={{ width: 14, height: 14 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="ds-card-title">You just ran your first conclave.</div>
              <div className="ds-card-sub">
                You&rsquo;ve seen a trigger, agents running in parallel, a channel loop resolving, and an output.
              </div>
            </div>
            <button className="ds-btn ds-btn-primary" onClick={onComplete}>
              Finish <I.ArrowR />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
