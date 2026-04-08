import { useRef, useLayoutEffect, useCallback } from "react";

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

// ── Auto-resizing textarea ───────────────────────────────────

interface AutoTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
}

export function AutoTextarea({ minRows = 4, className, value, onChange, ...rest }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(resize, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => { onChange?.(e); resize(); }}
      rows={minRows}
      className={`${className ?? ""} resize-none overflow-hidden`}
      style={{ maxHeight: "50vh" }}
      {...rest}
    />
  );
}
