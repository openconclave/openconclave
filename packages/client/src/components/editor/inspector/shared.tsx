import { useRef, useLayoutEffect, useCallback, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";

export const INPUT_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm";
export const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`;

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

export function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ── Auto-resizing textarea with expand button ────────────────

interface AutoTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
  label?: string;
}

export function AutoTextarea({ minRows = 4, label, className, value, onChange, ...rest }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(resize, [value, resize]);

  return (
    <>
      <div className="relative group">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => { onChange?.(e); resize(); }}
          rows={minRows}
          className={`${className ?? ""} resize-none overflow-hidden pr-8`}
          style={{ maxHeight: "50vh" }}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-muted-foreground hover:bg-accent transition-all"
          aria-label="Expand editor"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <EditorModal
          value={(value as string) ?? ""}
          onChange={onChange}
          label={label}
          className={className}
          onClose={() => setExpanded(false)}
          {...rest}
        />
      )}
    </>
  );
}

// ── Modal editor ─────────────────────────────────────────────

interface EditorModalProps {
  value: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  label?: string;
  className?: string;
  onClose: () => void;
  placeholder?: string;
  spellCheck?: boolean;
}

function EditorModal({ value, onChange, label, className, onClose, ...rest }: EditorModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Focus the textarea when modal opens
    setTimeout(() => textareaRef.current?.focus(), 0);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Proxy change events through a synthetic-like event object
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e);
  }, [onChange]);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Dialog */}
      <div className="relative flex flex-col w-[90vw] max-w-4xl h-[80vh] rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <span className="text-sm font-medium text-foreground">{label ?? "Editor"}</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          className={`flex-1 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none ${className?.includes("font-mono") ? "font-mono" : ""}`}
          {...rest}
        />
      </div>
    </div>,
    document.body
  );
}
