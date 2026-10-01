import { useEffect } from "react";
import { importSnapshot } from "../lib/api";
import { decodeHandoff, readHandoffFragment } from "../lib/handoff";
import { LOCAL_MODE } from "../lib/mode";
import { describeRefresh, parseRefreshHandoff, storeHandoff, summarizeOutcome } from "../lib/refreshHandoff";
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
 *
 * The browser-only build has no server for the script to post to, so the script
 * brings the cases themselves back in the URL fragment and this stores them.
 */
export function useRefreshHandoff(showToast: ShowToast, refresh: RefreshSummary) {
  useEffect(() => {
    if (LOCAL_MODE) {
      const encoded = readHandoffFragment(window.location.hash);
      if (!encoded) return;

      // The fragment is case data. It comes out of the address bar, and so out of
      // history and any shared link, before anything else happens.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);

      void (async () => {
        let payload;
        try {
          payload = await decodeHandoff(encoded);
        } catch {
          showToast("error", "The refresh came back unreadable. Run it again from USCIS.");
          return;
        }
        if (payload.note === "wrong-site") {
          showToast("error", "That was not a myUSCIS page. Open my.uscis.gov, sign in, then share that page.");
          return;
        }
        const handoff = await storeHandoff(payload, importSnapshot);
        const fresh = await refresh(true);
        const { tone, message } = describeRefresh(handoff, fresh ? summarizeOutcome(fresh) : null);
        showToast(tone, message);
      })();
      return;
    }

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
