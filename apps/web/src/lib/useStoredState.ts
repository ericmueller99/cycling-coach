import { useState } from 'react';

/** State remembered on this device (view toggles). Storage can be missing or blocked; then it's just state. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // Private mode or storage off: the toggle still works for this visit.
    }
  };
  return [value, set];
}
