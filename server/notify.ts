// Which stored changes earn a push. Pure.
//
// Only what USCIS itself said, and only when it matters (milestone or step).
// Tracker facts (added to tracking, silent updates) and quiet entries never
// push: a silent update is the tracker noticing the case clock moved, not news.

import { easternDate } from "../shared/dates.js";
import { describeChange } from "../shared/timeline.js";
import type { ChangeDraft } from "../shared/domain.js";

export type PushItem = {
  title: string;
  body: string;
  /** `case:<id>:<code>:<date>`: the OS collapses a repeat of the same thing on the same day. */
  tag: string;
  /** Indexes into the input array of every change this push covers. */
  covers: number[];
};

export function selectNotifiable(changes: ChangeDraft[], caseId: string, formType: string | null): PushItem[] {
  const byTag = new Map<string, PushItem>();
  changes.forEach((change, index) => {
    if (change.source !== "uscis") return;
    const info = describeChange(change);
    if (!info || info.described.significance === "quiet") return;
    const code = info.code ?? info.kind;
    const tag = `case:${caseId}:${code}:${easternDate(change.occurredAt)}`;
    const existing = byTag.get(tag);
    if (existing) {
      existing.covers.push(index);
      return;
    }
    byTag.set(tag, {
      title: `${formType ?? "USCIS case"}: ${info.described.title}`,
      body: info.described.meaning,
      tag,
      covers: [index],
    });
  });
  return [...byTag.values()];
}
