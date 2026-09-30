// Turns a person's cases' normalized timelines into the history the board shows.
//
// Two jobs, both pure:
//  - merge entries two cases share (an I-485 and an I-765 read the same ELIS
//    events) into one row that names both cases;
//  - split entries into meaningful ones and quiet runs, so a burst of silent
//    updates reads as one muted row instead of noise between real movement.

import type { TimelineEntry } from "./types";
import { presentEntry } from "./uscisCopy";

export type HistoryEntry = {
  /** Stable across renders: the id of the first member seen. */
  key: string;
  /** The entry the row reads from (newest member). */
  entry: TimelineEntry;
  /** Every case's copy of this entry. One member unless cases share it. */
  members: TimelineEntry[];
  caseIds: string[];
};

export type HistoryBlock =
  | { type: "entry"; item: HistoryEntry }
  | { type: "quiet"; items: HistoryEntry[]; from: string; to: string; count: number };

/** Entries two cases record identically: same kind, code, day and appointment. Only USCIS's own entries can be shared. */
function shareKey(entry: TimelineEntry): string | null {
  const shareable = entry.kind === "event" || entry.kind === "notice" || entry.kind === "silent_update";
  if (!shareable || (entry.source !== "uscis" && entry.kind !== "silent_update")) return null;
  return [entry.kind, entry.code ?? entry.title, entry.occurredOn, entry.appointmentAt ?? ""].join("|");
}

/** Newest first. Entries shared across different cases fold into one item. */
export function mergeSharedEntries(cases: { id: string; timeline: TimelineEntry[] }[]): HistoryEntry[] {
  const merged = new Map<string, HistoryEntry>();
  const items: HistoryEntry[] = [];

  for (const caseInfo of cases) {
    for (const entry of caseInfo.timeline) {
      const shared = shareKey(entry);
      const existing = shared ? merged.get(shared) : undefined;
      if (existing && !existing.caseIds.includes(caseInfo.id)) {
        existing.members.push(entry);
        existing.caseIds.push(caseInfo.id);
        if (entry.occurredAt > existing.entry.occurredAt) existing.entry = entry;
        continue;
      }
      const item: HistoryEntry = { key: entry.id, entry, members: [entry], caseIds: [caseInfo.id] };
      if (shared) merged.set(shared, item);
      items.push(item);
    }
  }

  return items.sort((a, b) => b.entry.occurredAt.localeCompare(a.entry.occurredAt) || a.key.localeCompare(b.key));
}

/**
 * Meaningful means USCIS said something new about the case: a status change,
 * notice, appointment, filing, or something the person recorded. Quiet means it
 * did not: silent updates, "added to tracking", and a step USCIS repeated after
 * it had already reported it (the same review event, read again on a later day).
 *
 * Takes entries newest first; returns the keys of the quiet ones.
 */
export function quietKeys(newestFirst: HistoryEntry[]): Set<string> {
  const quiet = new Set<string>();
  const seenSteps = new Set<string>();
  // A status row USCIS words as a sentence often restates an event from the same day.
  const eventsByDay = new Set(newestFirst.filter((i) => i.entry.kind === "event" || i.entry.kind === "notice").map((i) => `${presentEntry(i.entry).tag}|${i.entry.occurredOn}`));
  for (let i = newestFirst.length - 1; i >= 0; i -= 1) {
    const item = newestFirst[i];
    const { entry } = item;
    if (entry.significance === "quiet" || entry.kind === "baseline" || entry.kind === "silent_update") {
      quiet.add(item.key);
      continue;
    }
    if (entry.kind === "status") {
      const shown = presentEntry(entry);
      const restates = shown.tag !== undefined && eventsByDay.has(`${shown.tag}|${entry.occurredOn}`);
      const id = `status|${shown.title}`;
      if (restates || seenSteps.has(id)) quiet.add(item.key);
      seenSteps.add(id);
      continue;
    }
    if (entry.significance === "step" && entry.kind === "event" && entry.code) {
      if (seenSteps.has(entry.code)) quiet.add(item.key);
      seenSteps.add(entry.code);
    }
  }
  return quiet;
}

/** Newest-first blocks: meaningful entries alone, consecutive quiet ones folded into a run. */
export function buildHistory(newestFirst: HistoryEntry[]): { blocks: HistoryBlock[]; preview: HistoryEntry[]; total: number } {
  const quiet = quietKeys(newestFirst);
  const blocks: HistoryBlock[] = [];
  let run: HistoryEntry[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const days = run.map((item) => item.entry.occurredOn).sort();
    const count = run.reduce((sum, item) => sum + item.entry.count, 0);
    blocks.push({ type: "quiet", items: run, from: days[0], to: days[days.length - 1], count });
    run = [];
  };

  for (const item of newestFirst) {
    if (quiet.has(item.key)) {
      run.push(item);
    } else {
      flush();
      blocks.push({ type: "entry", item });
    }
  }
  flush();

  const preview = newestFirst.filter((item) => !quiet.has(item.key)).slice(0, 3);
  return { blocks, preview, total: newestFirst.length };
}
