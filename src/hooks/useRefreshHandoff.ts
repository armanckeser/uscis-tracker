import { useCallback, useEffect, useState } from "react";
import { importSnapshot } from "../lib/api";
import { decodeHandoff, readHandoffFragment } from "../lib/handoff";
import { ignoreReceipts, ignoredReceipts } from "../lib/ignoredReceipts";
import { LOCAL_MODE } from "../lib/mode";
import {
  combineHandoffs,
  describeRefresh,
  parseRefreshHandoff,
  storeHandoff,
  summarizeOutcome,
  trackerStateOf,
  type FoundCase,
  type RefreshHandoff,
} from "../lib/refreshHandoff";
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
 * Cases come back in the URL fragment when the script could not post them: always
 * in the browser-only build, which has no server, and self-hosted for a case the
 * server has never seen. This stores those. A new case with an obvious owner is
 * added on the spot; the rest are returned as `found` for the user to place.
 */
export function useRefreshHandoff(showToast: ShowToast, refresh: RefreshSummary) {
  const [found, setFound] = useState<FoundCase[]>([]);

  useEffect(() => {
    const encoded = readHandoffFragment(window.location.hash);
    const posted = LOCAL_MODE ? null : parseRefreshHandoff(window.location.search);
    if (!encoded && !posted) return;

    // The fragment is case data. It comes out of the address bar, and so out of
    // history and any shared link, before anything else happens.
    window.history.replaceState(null, "", window.location.pathname + (LOCAL_MODE ? window.location.search : ""));

    void (async () => {
      let stored: RefreshHandoff | null = null;
      if (encoded) {
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
        // Whose a case is depends on what is tracked right now, not on what was
        // on screen before the trip to USCIS.
        const current = await refresh(true);
        if (!current) return;
        const result = await storeHandoff(payload, trackerStateOf(current, ignoredReceipts()), importSnapshot);
        stored = result.handoff;
        setFound(result.found);
      }

      const handoff = combineHandoffs(posted, stored);
      if (!handoff) return;
      const fresh = await refresh(true);
      const { tone, message } = describeRefresh(handoff, fresh ? summarizeOutcome(fresh) : null);
      showToast(tone, message);
    })();
  }, [showToast, refresh]);

  const assignFound = useCallback(
    async (person: { id: string; name: string }) => {
      let added = 0;
      for (const item of found) {
        try {
          await importSnapshot({ raw: item.raw, personId: person.id });
          added += 1;
        } catch {
          // Reported below as a shortfall.
        }
      }
      setFound([]);
      await refresh(true);
      if (added === found.length) {
        showToast("success", `${added} ${added === 1 ? "case" : "cases"} added for ${person.name}.`);
      } else {
        showToast("error", `${added} of ${found.length} cases were added for ${person.name}. Refresh from USCIS to try the rest again.`);
      }
    },
    [found, refresh, showToast],
  );

  const dismissFound = useCallback(() => {
    ignoreReceipts(found.map((item) => item.receiptNumber));
    setFound([]);
  }, [found]);

  return { found, assignFound, dismissFound };
}
