import { easternDate } from "./dates.js";
import { describeEvent, describeNotice, type Described, type LifecycleTone, type Significance } from "./lifecycle.js";

/** Who asserted a fact. USCIS said it, the tracker derived it, or a human told us. */
export type FactSource = "uscis" | "tracker" | "human";

export type ChangeType = "baseline" | "submission" | "status" | "closed" | "event" | "notice" | "field" | "silent_update";

/** A stored `case_changes` row as the API exposes it. */
export type ChangeRecord = {
  id: string;
  caseId: string;
  snapshotId: string;
  changeType: ChangeType;
  fieldPath: string | null;
  label: string;
  occurredAt: string;
  payload: unknown;
  source: FactSource;
  /** When we found out. */
  firstSeenAt: string;
  /** Null until read. */
  acknowledgedAt: string | null;
};

export type FactRecord = {
  id: string;
  caseId: string;
  kind: "appointment_attended" | "appointment_missed";
  occurredOn: string;
  letterId: string | null;
  note: string | null;
  createdAt: string;
};

export type TimelineKind = "event" | "notice" | "status" | "closed" | "submission" | "baseline" | "silent_update" | "fact";

/** One underlying observation folded into a (possibly collapsed) timeline entry. Oldest first. */
export type TimelineSubEntry = {
  id: string;
  occurredAt: string;
  /** The snapshot that first recorded it. Null for human facts. */
  snapshotId: string | null;
  firstSeenAt: string;
  unread: boolean;
  payload: unknown;
};

export type TimelineEntry = {
  /** The id of the earliest underlying change, so it stays stable as repeats fold in. */
  id: string;
  caseId: string;
  source: FactSource;
  kind: TimelineKind;
  /** eventCode, notice actionType, or fact kind. Absent for status/closed/submission/baseline/silent_update. */
  code?: string;
  title: string;
  meaning: string;
  tone: LifecycleTone;
  /** Local (US Eastern) calendar date of the latest underlying item. */
  occurredOn: string;
  /** Latest underlying item. */
  occurredAt: string;
  significance: Significance;
  /** How many same-code items on the same local date were folded into this entry. */
  count: number;
  /** True when any folded item is still unacknowledged. */
  unread: boolean;
  /** Notice letterId, when the entry is a notice. */
  letterId: string | null;
  /** Notice appointmentDateTime, when it carries one. */
  appointmentAt: string | null;
  /** Lifecycle tag (rfe, approved, ...) when the registry knows the entry. */
  tag?: Described["tag"];
  /** Stage the entry moves the case into, when it moves it. */
  stage?: Described["stage"];
  entries: TimelineSubEntry[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function bracketCode(fieldPath: string | null, prefix: string): string | null {
  const match = fieldPath?.match(new RegExp(`^${prefix}\\[(.+)\\]$`));
  return match?.[1] ?? null;
}

export function defaultSource(changeType: ChangeType): FactSource {
  return changeType === "baseline" || changeType === "silent_update" || changeType === "field" ? "tracker" : "uscis";
}

export type DescribedChange = {
  kind: TimelineKind;
  code?: string;
  described: Pick<Described, "title" | "meaning" | "tone" | "significance"> & Partial<Pick<Described, "stage" | "tag">>;
};

/** Title, meaning and significance for one change, from the shared registry. Null for rows that never show (raw field diffs). */
export function describeChange(change: Pick<ChangeRecord, "changeType" | "fieldPath" | "payload">): DescribedChange | null {
  const payload = record(change.payload);
  switch (change.changeType) {
    case "event": {
      const code = str(payload.eventCode) ?? bracketCode(change.fieldPath, "events") ?? undefined;
      return { kind: "event", code, described: describeEvent(code) };
    }
    case "notice": {
      const code = str(payload.actionType) ?? bracketCode(change.fieldPath, "notices") ?? undefined;
      return { kind: "notice", code, described: describeNotice(code) };
    }
    case "status": {
      const next = str(payload.new);
      const known = next ? describeNotice(next) : null;
      // A status USCIS words like a notice ("Case Was Approved") inherits that
      // notice's weight; anything else is a step, never a milestone.
      const entry = known?.entry ? known : null;
      return {
        kind: "status",
        described: {
          title: next ? `Status: ${next}` : "Status changed",
          meaning: entry ? entry.meaning : "The visible case status changed in the USCIS response.",
          tone: entry ? entry.tone : "info",
          significance: entry ? entry.significance : "step",
          stage: entry?.stage,
          tag: entry?.tag,
        },
      };
    }
    case "closed": {
      const done = payload.new === true || payload.new === "true";
      return {
        kind: "closed",
        described: {
          title: done ? "Case closed" : "Case reopened",
          meaning: done ? "USCIS marked the case complete." : "USCIS reopened the case.",
          tone: done ? "good" : "action",
          significance: "step",
        },
      };
    }
    case "submission":
      return {
        kind: "submission",
        described: { title: "Filed", meaning: "The submission time USCIS recorded for the application.", tone: "info", significance: "milestone", stage: "filed", tag: "filed" },
      };
    case "baseline":
      return {
        kind: "baseline",
        described: { title: "Added to tracking", meaning: "The first saved snapshot for this case. Later entries show what changed after this point.", tone: "neutral", significance: "quiet" },
      };
    case "silent_update": {
      const moved = Array.isArray(payload.alsoChanged) ? payload.alsoChanged.filter((p): p is string => typeof p === "string") : [];
      return {
        kind: "silent_update",
        described: {
          title: "Silent update",
          meaning:
            "USCIS touched this case without a new status, event, or notice. Quiet movement, not a decision." +
            (moved.length ? ` Fields that moved: ${moved.join(", ")}.` : ""),
          tone: "neutral",
          significance: "quiet",
        },
      };
    }
    case "field":
      return null;
  }
}

const FACT_COPY: Record<FactRecord["kind"], { title: string; meaning: string; tone: LifecycleTone }> = {
  appointment_attended: { title: "Appointment attended", meaning: "You recorded that you went to the appointment.", tone: "good" },
  appointment_missed: { title: "Appointment missed", meaning: "You recorded that you missed the appointment. Check the notice for how to reschedule.", tone: "bad" },
};

/**
 * Turns stored changes and human facts into what the case page shows.
 *
 * - Same-code events (and silent updates) on the same US Eastern date fold into
 *   one entry with a `count`; the originals stay in `entries`. Nothing is
 *   dropped: a folded entry is a view over lossless rows.
 * - Raw `field` rows are evidence for silent updates and never render.
 * - Newest first, ties broken by id so the order is deterministic.
 */
export function normalizeTimeline(changes: ChangeRecord[], facts: FactRecord[] = []): TimelineEntry[] {
  const groups = new Map<string, TimelineEntry>();

  const sorted = [...changes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  for (const change of sorted) {
    const info = describeChange(change);
    if (!info) continue;
    const source = change.source ?? defaultSource(change.changeType);
    const date = easternDate(change.occurredAt);
    const payload = record(change.payload);
    const collapses = info.kind === "event" || info.kind === "silent_update";
    const key = collapses ? `${change.caseId}|${info.kind}|${info.code ?? ""}|${date}|${source}` : `${change.caseId}|${change.id}`;
    const sub: TimelineSubEntry = {
      id: change.id,
      occurredAt: change.occurredAt,
      snapshotId: change.snapshotId,
      firstSeenAt: change.firstSeenAt,
      unread: change.acknowledgedAt === null,
      payload: change.payload,
    };
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(sub);
      existing.count += 1;
      existing.occurredAt = change.occurredAt;
      existing.occurredOn = date;
      existing.unread = existing.unread || sub.unread;
      continue;
    }
    groups.set(key, {
      id: change.id,
      caseId: change.caseId,
      source,
      kind: info.kind,
      code: info.code,
      title: info.described.title,
      meaning: info.described.meaning,
      tone: info.described.tone,
      occurredOn: date,
      occurredAt: change.occurredAt,
      significance: info.described.significance,
      count: 1,
      unread: sub.unread,
      letterId: info.kind === "notice" ? str(payload.letterId) : null,
      appointmentAt: info.kind === "notice" ? str(payload.appointmentDateTime) : null,
      tag: info.described.tag,
      stage: info.described.stage,
      entries: [sub],
    });
  }

  for (const fact of facts) {
    const copy = FACT_COPY[fact.kind];
    // Human memory is day-precision; noon UTC keeps the fact on its own date in every US zone.
    const at = `${fact.occurredOn}T12:00:00.000Z`;
    groups.set(`fact|${fact.id}`, {
      id: fact.id,
      caseId: fact.caseId,
      source: "human",
      kind: "fact",
      code: fact.kind,
      title: copy.title,
      meaning: fact.note ? `${copy.meaning} Note: ${fact.note}` : copy.meaning,
      tone: copy.tone,
      occurredOn: fact.occurredOn,
      occurredAt: at,
      significance: "step",
      count: 1,
      unread: false,
      letterId: fact.letterId,
      appointmentAt: null,
      entries: [{ id: fact.id, occurredAt: at, snapshotId: null, firstSeenAt: fact.createdAt, unread: false, payload: { note: fact.note, letterId: fact.letterId } }],
    });
  }

  return [...groups.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
}
