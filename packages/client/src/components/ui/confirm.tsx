import { useState, useCallback, useEffect } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

let showConfirmFn: ((title: string, message: string) => Promise<boolean>) | null = null;

export function confirm(title: string, message: string): Promise<boolean> {
  if (!showConfirmFn) return Promise.resolve(false);
  return showConfirmFn(title, message);
}

export function ConfirmDialog() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const show = useCallback((title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title,
        message,
        onConfirm: () => {
          setState((s) => ({ ...s, open: false }));
          resolve(true);
        },
      });

      // Store reject for cancel
      (window as unknown as Record<string, unknown>).__confirmReject = () => {
        setState((s) => ({ ...s, open: false }));
        resolve(false);
      };
    });
  }, []);

  useEffect(() => {
    showConfirmFn = show;
    return () => { showConfirmFn = null; };
  }, [show]);

  if (!state.open) return null;

  const cancel = () => {
    const reject = (window as unknown as Record<string, unknown>).__confirmReject as (() => void) | undefined;
    reject?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={cancel} />
      <div className="relative rounded-xl border border-border bg-card p-6 shadow-2xl w-[400px] animate-in zoom-in-95 fade-in duration-150">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{state.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={cancel}
            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={state.onConfirm}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
