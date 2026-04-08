import { Plus } from "lucide-react";

export function Header({
  title,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; href: string }[];
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-6">
      <div className="flex items-center gap-0 min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1.5 mr-3 shrink-0">
            {breadcrumb.map((item, i) => (
              <span key={item.href} className="flex items-center gap-1.5">
                <a
                  href={item.href}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {item.label}
                </a>
                <span className="text-sm text-muted-foreground/40">/</span>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-lg font-semibold min-w-0">{title}</h1>
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}

export function NewButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}
