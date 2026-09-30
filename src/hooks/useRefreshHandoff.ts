import { useEffect } from "react";
import { describeRefresh, parseRefreshHandoff, summarizeOutcome } from "../lib/refreshHandoff";
import type { RefreshSummary } from "../lib/types";
import type { ShowToast } from "./useToast";

/**
 * Handles the return trip from a refresh bookmarklet or Shortcut.
 *
 * The script runs cross-origin on my.uscis.gov and posts snapshots with an opaque
 * no-cors request, so all it can honestly report is how many responses it read and
 * delivered. It appends those counts and navigates here; this reads them, refreshes
 * from the server so the timeline shows what was actually stored, and clears the
 * params so a reload does not replay the message.
 *
 * The toast waits for that refresh. The counts alone cannot tell the difference
 * between a quiet case and a broken import, and the server can, so the message is
 * built after the answer is in rather than guessed at before.
 */
export function useRefreshHandoff(showToast: ShowToast, refresh: RefreshSummary) {
  useEffect(() => {
    const handoff = parseRefreshHandoff(window.location.search);
    if (!handoff) return;

    window.history.replaceState(null, "", window.location.pathname);

    void (async () => {
      const fresh = await refresh(true);
      const { tone, message } = describeRefresh(handoff, fresh ? summarizeOutcome(fresh) : null);
      showToast(tone, message);
    })();
  }, [showToast, refresh]);
}
