import { useState, type ReactNode } from "react";

export function Section({
  title,
  sub,
  right,
  children,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
        {right && <div className="right">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function FieldRow({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field-row">
      <div className="flabel">
        <div className="l">{label}</div>
        {help && <div className="h">{help}</div>}
      </div>
      <div className="fctrl">{children}</div>
    </div>
  );
}

export function CopyBox({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="copy-box">
      {label && <div className="copy-box-label">{label}</div>}
      <div className="copy-box-row">
        <pre>{text}</pre>
        <button type="button" className="copy-btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "err";
  children: ReactNode;
}) {
  return <span className={`settings-pill ${tone}`}>{children}</span>;
}

export function SecretInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="settings-input-group">
      <input
        className="settings-input mono"
        type={shown ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="settings-input-btn" onClick={() => setShown((s) => !s)}>
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
