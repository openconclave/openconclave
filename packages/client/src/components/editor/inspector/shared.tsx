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
