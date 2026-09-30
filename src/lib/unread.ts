// What counts as news, in one place.
//
// Two questions need the same answer: the new-since banner ("what has arrived
// since I looked?") and the report a refresh hands back ("was that read worth
// anything?"). If they disagree, the app says something arrived and then shows
// an empty list, or says nothing arrived while a row sits unread.
//
// News is any unread entry except "added to tracking" (an app event, not a USCIS
// one). A silent update stays news: it is the only report of quiet movement, and
// a refresh that hid it would look exactly like a broken import.

import type { CaseSummary, TimelineEntry } from "./types";

export type UnreadItem = { entry: TimelineEntry; caseRecord: CaseSummary };

/** Unread entries, newest discovery first: the order we found out, not the date USCIS stamped. */
export function unreadEntries(cases: CaseSummary[]): UnreadItem[] {
  const items: UnreadItem[] = [];
  for (const caseRecord of cases) {
    for (const entry of caseRecord.timeline) {
      if (entry.unread && entry.kind !== "baseline") items.push({ entry, caseRecord });
    }
  }
  const found = (item: UnreadItem) => item.entry.entries.reduce((max, sub) => (sub.firstSeenAt > max ? sub.firstSeenAt : max), "");
  return items.sort((a, b) => found(b).localeCompare(found(a)));
}

/** When USCIS last moved any case: the newest `lastChangedAt`, or null if none ever has. */
export function lastMovementAt(cases: Pick<CaseSummary, "lastChangedAt">[]): string | null {
  const moments = cases.map((c) => (c.lastChangedAt ? new Date(c.lastChangedAt).getTime() : NaN)).filter((t) => Number.isFinite(t));
  if (moments.length === 0) return null;
  return new Date(Math.max(...moments)).toISOString();
}
