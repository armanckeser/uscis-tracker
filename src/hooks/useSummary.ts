import { useCallback, useEffect, useState } from "react";
import { getSummary } from "../lib/api";
import type { Summary } from "../lib/types";
import type { ShowToast } from "./useToast";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Loads the tracker summary, refreshes it on an interval, and exposes a manual
 * refresh.
 *
 * `refresh` hands back what it fetched, not just void: a caller that triggered the
 * refresh often has to say something about the result in the same breath (the
 * refresh handoff reports whether anything actually arrived) and reading the state
 * it just set would give it the render before this one.
 */
export function useSummary(showToast: ShowToast) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (silent = false): Promise<Summary | null> => {
      if (!silent) setLoading(true);
      try {
        const fetched = await getSummary();
        setSummary(fetched);
        return fetched;
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Could not load tracker data.");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(true), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { summary, loading, refresh };
}
