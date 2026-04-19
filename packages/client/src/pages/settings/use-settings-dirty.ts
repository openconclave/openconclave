import { useCallback, useMemo, useState } from "react";

type Values = Record<string, string>;

export interface DirtyState {
  values: Values;
  saved: Values;
  dirty: boolean;
  editCount: number;
  setValue: (key: string, value: string) => void;
  reset: (next: Values) => void;
  diff: () => Values;
}

export function useSettingsDirty(initial: Values): DirtyState {
  const [saved, setSaved] = useState<Values>(initial);
  const [values, setValues] = useState<Values>(initial);

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback((next: Values) => {
    setSaved(next);
    setValues(next);
  }, []);

  const { dirty, editCount, diff } = useMemo(() => {
    let count = 0;
    const changed: Values = {};
    const keys = new Set([...Object.keys(values), ...Object.keys(saved)]);
    for (const k of keys) {
      if ((values[k] ?? "") !== (saved[k] ?? "")) {
        count++;
        changed[k] = values[k] ?? "";
      }
    }
    return {
      dirty: count > 0,
      editCount: count,
      diff: () => changed,
    };
  }, [values, saved]);

  return { values, saved, dirty, editCount, setValue, reset, diff };
}
