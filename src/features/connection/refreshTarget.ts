import type { Delivery } from "../../lib/bookmarklet";
import { LOCAL_MODE, appUrl } from "../../lib/mode";

/**
 * Where a refresh script comes back to, and how it brings the cases.
 *
 * With no server to post to, the scripts carry the cases back in the URL
 * fragment, so they need the app's full address rather than just its origin.
 */
export function refreshTarget(): { trackerOrigin: string; delivery: Delivery } {
  return LOCAL_MODE
    ? { trackerOrigin: appUrl(), delivery: "fragment" }
    : { trackerOrigin: window.location.origin, delivery: "post" };
}
