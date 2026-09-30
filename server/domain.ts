import crypto from "node:crypto";
import { describeEvent } from "../shared/lifecycle.js";
import { defaultSource, type FactSource } from "../shared/timeline.js";

export { ET_TIME_ZONE } from "../shared/dates.js";

/**
 * Raised when a response body is USCIS telling us we are not signed in, rather
 * than case data: an `error` wrapper, or `data: null`. Distinguished from a
 * malformed paste so the UI can say "sign in and copy it again".
 */
export class UscisSessionError extends Error {}

export type UscisEvent = {
  eventId?: string;
  eventCode?: string;
  createdAtTimestamp?: string;
  [key: string]: unknown;
};

export type UscisNotice = {
  letterId?: string;
  actionType?: string;
  generationDate?: string;
  [key: string]: unknown;
};

export type UscisCaseData = {
  receiptNumber: string;
  formType?: string;
  caseStatus?: string;
  submissionTimestamp?: string;
  updatedAtTimestamp?: string;
  closed?: boolean;
  events?: UscisEvent[];
  notices?: UscisNotice[];
  [key: string]: unknown;
};

export type JsonDiff = {
  path: string;
  type: "added" | "removed" | "changed";
  value?: unknown;
  old?: unknown;
  new?: unknown;
};

export type ChangeDraft = {
  /** Who asserted it: USCIS said it, or the tracker derived it. Human facts live in case_facts. */
  source: FactSource;
  changeType: "baseline" | "submission" | "status" | "closed" | "event" | "notice" | "field" | "silent_update";
  fieldPath: string | null;
  label: string;
  severity: "info" | "success" | "warning" | "error";
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function isValidReceipt(receipt: string) {
  return /^[A-Z]{3}[0-9]{10}$/.test(receipt.trim().toUpperCase());
}

export function normalizeReceipt(receipt: string) {
  return receipt.trim().toUpperCase();
}

export function normalizeUscisResponse(input: unknown): UscisCaseData {
  if (!input || typeof input !== "object") {
    throw new Error("USCIS response was not a JSON object.");
  }

  const maybeWrapper = input as { data?: unknown; error?: unknown };
  if ("error" in maybeWrapper && !maybeWrapper.data) {
    throw new UscisSessionError("USCIS returned an error instead of case data. Sign in to USCIS and copy the response again.");
  }
  if (maybeWrapper.data === null) {
    throw new UscisSessionError("USCIS returned an empty response, which means that browser is not signed in.");
  }

  const data = "data" in maybeWrapper ? maybeWrapper.data : input;
  if (!data || typeof data !== "object") {
    throw new Error("USCIS response did not include case data.");
  }

  const caseData = data as UscisCaseData;
  if (!caseData.receiptNumber || !isValidReceipt(caseData.receiptNumber)) {
    throw new Error("USCIS response did not include a valid receipt number.");
  }

  return {
    ...caseData,
    receiptNumber: normalizeReceipt(caseData.receiptNumber),
    events: Array.isArray(caseData.events) ? caseData.events : [],
    notices: Array.isArray(caseData.notices) ? caseData.notices : [],
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

export function hashCaseData(data: UscisCaseData) {
  return crypto.createHash("sha256").update(stableStringify(data)).digest("hex");
}

export function computeJsonDiff(oldData: unknown, newData: unknown): JsonDiff[] {
  const ignoreFields = new Set(["updatedAtTimestamp"]);
  const changes: JsonDiff[] = [];

  function compare(path: string, oldValue: unknown, newValue: unknown) {
    if (ignoreFields.has(path)) return;

    const oldMissing = oldValue === undefined || oldValue === null;
    const newMissing = newValue === undefined || newValue === null;
    if (oldMissing && !newMissing) {
      changes.push({ path, type: "added", value: newValue });
      return;
    }
    if (!oldMissing && newMissing) {
      changes.push({ path, type: "removed", value: oldValue });
      return;
    }
    if (oldMissing && newMissing) return;

    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      if (path === "events") {
        const oldIds = new Set(oldValue.map((event) => (event as UscisEvent).eventId));
        for (const event of newValue as UscisEvent[]) {
          if (!oldIds.has(event.eventId)) {
            changes.push({ path: `${path}[${event.eventCode ?? "new"}]`, type: "added", value: event });
          }
        }
        return;
      }
      if (path === "notices") {
        const oldIds = new Set(oldValue.map((notice) => (notice as UscisNotice).letterId));
        for (const notice of newValue as UscisNotice[]) {
          if (!oldIds.has(notice.letterId)) {
            changes.push({ path: `${path}[${notice.actionType ?? "new"}]`, type: "added", value: notice });
          }
        }
        return;
      }
      if (stableStringify(oldValue) !== stableStringify(newValue)) {
        changes.push({ path, type: "changed", old: oldValue, new: newValue });
      }
      return;
    }

    if (typeof oldValue !== typeof newValue) {
      changes.push({ path, type: "changed", old: oldValue, new: newValue });
      return;
    }

    if (typeof oldValue === "object" && typeof newValue === "object") {
      const keys = new Set([
        ...Object.keys(oldValue as Record<string, unknown>),
        ...Object.keys(newValue as Record<string, unknown>),
      ]);
      for (const key of keys) {
        compare(path ? `${path}.${key}` : key, (oldValue as Record<string, unknown>)[key], (newValue as Record<string, unknown>)[key]);
      }
      return;
    }

    if (oldValue !== newValue) {
      changes.push({ path, type: "changed", old: oldValue, new: newValue });
    }
  }

  compare("", oldData, newData);
  return changes;
}

type Draft = Omit<ChangeDraft, "source">;

function withSource(drafts: Draft[]): ChangeDraft[] {
  return drafts.map((draft) => ({ ...draft, source: defaultSource(draft.changeType) }));
}

export function buildChanges(prev: UscisCaseData | null, curr: UscisCaseData, checkedAt: string): ChangeDraft[] {
  return withSource(buildDrafts(prev, curr, checkedAt));
}

function buildDrafts(prev: UscisCaseData | null, curr: UscisCaseData, checkedAt: string): Draft[] {
  const changes: Draft[] = [];
  const form = curr.formType ?? "Case";
  const fallbackWhen = curr.updatedAtTimestamp ?? checkedAt;

  if (!prev) {
    if (curr.submissionTimestamp) {
      changes.push({
        changeType: "submission",
        fieldPath: "submissionTimestamp",
        label: `${form} ${curr.receiptNumber} submitted`,
        severity: "info",
        occurredAt: curr.submissionTimestamp,
        payload: { receiptNumber: curr.receiptNumber },
      });
    }
    changes.push({
      changeType: "baseline",
      fieldPath: null,
      label: `${form} ${curr.receiptNumber} added to tracking`,
      severity: curr.closed ? "success" : "info",
      occurredAt: fallbackWhen,
      payload: { receiptNumber: curr.receiptNumber, caseStatus: curr.caseStatus, closed: curr.closed },
    });
    for (const event of curr.events ?? []) {
      changes.push(eventToChange(form, event, curr, false, checkedAt));
    }
    for (const notice of curr.notices ?? []) {
      changes.push(noticeToChange(form, notice, false, checkedAt));
    }
    return changes;
  }

  if (prev.caseStatus !== curr.caseStatus && curr.caseStatus) {
    changes.push({
      changeType: "status",
      fieldPath: "caseStatus",
      label: `${form} status changed to ${curr.caseStatus}`,
      severity: curr.closed ? "success" : "info",
      occurredAt: fallbackWhen,
      payload: { old: prev.caseStatus, new: curr.caseStatus },
    });
  }

  if (prev.closed !== curr.closed && curr.closed !== undefined) {
    changes.push({
      changeType: "closed",
      fieldPath: "closed",
      label: curr.closed ? `${form} marked complete` : `${form} reopened`,
      severity: curr.closed ? "success" : "warning",
      occurredAt: fallbackWhen,
      payload: { old: prev.closed, new: curr.closed },
    });
  }

  const prevEventIds = new Set((prev.events ?? []).map((event) => event.eventId));
  for (const event of curr.events ?? []) {
    if (!prevEventIds.has(event.eventId)) {
      changes.push(eventToChange(form, event, curr, true, checkedAt));
    }
  }

  const prevNoticeIds = new Set((prev.notices ?? []).map((notice) => notice.letterId));
  for (const notice of curr.notices ?? []) {
    if (!prevNoticeIds.has(notice.letterId)) {
      changes.push(noticeToChange(form, notice, true, checkedAt));
    }
  }

  // Everything above is movement USCIS *names*: a status, a completion flag, an
  // event, a notice. Everything below is movement it does not name.
  const namedMovementCount = changes.length;

  const fieldDiffs = computeJsonDiff(prev, curr).filter(
    (diff) =>
      diff.path !== "caseStatus" &&
      diff.path !== "closed" &&
      !diff.path.startsWith("events") &&
      !diff.path.startsWith("notices"),
  );

  // Raw field diffs are not stored as rows of their own: they duplicated the
  // silent_update evidence. They ride on the silent_update payload below, and the
  // snapshots stay lossless for anything else.

  // A silent update is a positive fact: the case moved and USCIS named nothing.
  // It is not "the diff was otherwise empty" — defining it that way meant a
  // single incidental field difference alongside the clock move (the common
  // case) downgraded real movement to `field` rows, which the timeline filters
  // out of view. So the update was recorded and then never shown. Any movement
  // USCIS leaves unnamed earns this row; the field diffs ride along as evidence.
  const caseClockAdvanced = Boolean(curr.updatedAtTimestamp) && prev.updatedAtTimestamp !== curr.updatedAtTimestamp;
  if (namedMovementCount === 0 && (caseClockAdvanced || fieldDiffs.length > 0)) {
    changes.push({
      changeType: "silent_update",
      fieldPath: "updatedAtTimestamp",
      label: `${form} silent update`,
      severity: "info",
      occurredAt: caseClockAdvanced && curr.updatedAtTimestamp ? curr.updatedAtTimestamp : fallbackWhen,
      payload: {
        old: prev.updatedAtTimestamp,
        new: curr.updatedAtTimestamp,
        caseClockAdvanced,
        alsoChanged: fieldDiffs.map((diff) => diff.path).filter((path) => path.length > 0),
        fieldDiffs,
      },
    });
  }

  return changes;
}

function eventToChange(form: string, event: UscisEvent, curr: UscisCaseData, isNew: boolean, checkedAt: string): Draft {
  const code = event.eventCode ?? "event";
  return {
    changeType: "event",
    fieldPath: `events[${code}]`,
    label: `${form} ${isNew ? "new event" : "event"}: ${describeEvent(event.eventCode).title}`,
    severity: code === "SA" ? "success" : "info",
    occurredAt: event.createdAtTimestamp ?? curr.updatedAtTimestamp ?? checkedAt,
    payload: event as Record<string, unknown>,
  };
}

function noticeToChange(form: string, notice: UscisNotice, isNew: boolean, checkedAt: string): Draft {
  const action = notice.actionType ?? "notice";
  return {
    changeType: "notice",
    fieldPath: `notices[${action}]`,
    label: `${form} ${isNew ? "new notice" : "notice"}: ${action}`,
    severity: "info",
    occurredAt: notice.generationDate ?? checkedAt,
    payload: notice as Record<string, unknown>,
  };
}

