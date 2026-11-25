import { useCallback, useState } from "react";

export interface Action {
  busy: boolean;
  error: unknown;
  /** Runs the work; returns whether it succeeded. The error, if any, is kept for display. */
  run(work: () => Promise<void>): Promise<boolean>;
  clear(): void;
}

/** Runs one state-changing request at a time and keeps its error for the screen to show. */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (reason) {
      setError(reason);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => setError(null), []);
  return { busy, error, run, clear };
}
