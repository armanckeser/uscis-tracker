import { useCallback, useState } from "react";
import { getSnapshot } from "../lib/api";
import type { SnapshotResponse } from "../lib/types";
import type { ShowToast } from "./useToast";

/**
 * Owns the raw-response modal: which snapshot is open, and how to open another.
 *
 * Fetching lived next to the rail, which meant the modal could only ever show the
 * snapshot a row pointed at. Opening one from inside the modal -- to get from a
 * row's evidence to the newest response on file -- needs the same opener the rail
 * uses, so it lives here where both can reach it.
 */
export function useSnapshotViewer(showToast: ShowToast) {
  const [snapshot, setSnapshot] = useState<SnapshotResponse["snapshot"] | null>(null);

  const open = useCallback(
    async (snapshotId: string) => {
      try {
        const data = await getSnapshot(snapshotId);
        setSnapshot(data.snapshot);
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Could not load snapshot.");
      }
    },
    [showToast],
  );

  const close = useCallback(() => setSnapshot(null), []);

  return { snapshot, open, close };
}
