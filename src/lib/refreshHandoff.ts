import { normalizeUscisResponse } from "../../shared/domain";
import { formatShortDay } from "./format";
import { lastMovementAt, unreadEntries } from "./unread";
import type { Summary } from "./types";
import type { ToastTone } from "../hooks/useToast";
import type { HandoffPayload } from "./handoff";

/**
 * What a refresh run reported when it handed back to the tracker.
 *
 * Three outcomes, not two. Both people's receipts are in one bookmark, but a
 * myUSCIS session can only read its own account's cases, so on any given run some
 * receipts are expected to be unreadable. That is the normal shape of a household
 * with two accounts, not a failure.
 */
export type RefreshHandoff = {
  /** Responses read and delivered to the tracker. */
  sent: number;
  /** Refused because they belong to another USCIS account. Expected, not broken. */
  denied: number;
  /** Refused for some other reason. Genuinely wrong. */
  failed: number;
  /** HTTP statuses seen on the refusals, for diagnosing an unexpected one. */
  codes: string;
  /** Read from USCIS, but not something the tracker could store. */
  unstored?: number;
  /** Of `sent`, the cases the tracker had never seen and started tracking. */
  added?: number;
  /** Who those were added for. */
  addedFor?: string;
  /** New cases waiting for the user to say whose they are. */
  found?: number;
};

/** A case the refresh found on the account that the tracker does not track yet. */
export type FoundCase = { raw: unknown; receiptNumber: string; formType: string | null };

/** What the tracker holds, as far as placing a returned case needs to know. */
export type TrackerState = {
  /** Receipts already tracked. Each records its owner, so these just get stored. */
  tracked: ReadonlySet<string>;
  /** Receipts the user deleted or declined. Never offered again. */
  ignored: ReadonlySet<string>;
  /** The only person in the tracker, when there is exactly one. */
  soleOwner: { id: string; name: string } | null;
};

export function trackerStateOf(summary: Summary, ignored: ReadonlySet<string>): TrackerState {
  const [only] = summary.people;
  return {
    tracked: new Set(summary.cases.map((caseRecord) => caseRecord.receiptNumber)),
    ignored,
    soleOwner: summary.people.length === 1 && only ? { id: only.id, name: only.name } : null,
  };
}

/**
 * Stores the cases a refresh carried back, one by one, so a single response the
 * tracker cannot store does not cost the rest.
 *
 * A case the tracker has never seen needs an owner. With one person in the
 * tracker there is nothing to ask. With more, a guess could file one person's
 * case under the other, so those are handed back for the user to place.
 */
export async function storeHandoff(
  payload: HandoffPayload,
  tracker: TrackerState,
  importSnapshot: (input: { raw: unknown; personId?: string }) => Promise<unknown>,
): Promise<{ handoff: RefreshHandoff; found: FoundCase[] }> {
  let sent = 0;
  let unstored = 0;
  let added = 0;
  const found: FoundCase[] = [];

  for (const raw of payload.cases) {
    try {
      const data = normalizeUscisResponse(raw);
      if (tracker.tracked.has(data.receiptNumber)) {
        await importSnapshot({ raw });
        sent += 1;
      } else if (tracker.ignored.has(data.receiptNumber)) {
        continue;
      } else if (tracker.soleOwner) {
        await importSnapshot({ raw, personId: tracker.soleOwner.id });
        sent += 1;
        added += 1;
      } else {
        found.push({ raw, receiptNumber: data.receiptNumber, formType: data.formType ?? null });
      }
    } catch {
      unstored += 1;
    }
  }

  return {
    handoff: {
      sent,
      denied: payload.denied,
      failed: payload.failed,
      codes: payload.codes,
      unstored,
      added,
      addedFor: added > 0 ? tracker.soleOwner?.name : undefined,
      found: found.length,
    },
    found,
  };
}

/** One run can report twice: counts in the address for what it posted, cases in the fragment for what it could not. */
export function combineHandoffs(posted: RefreshHandoff | null, stored: RefreshHandoff | null): RefreshHandoff | null {
  if (!posted || !stored) return posted ?? stored;
  return {
    ...stored,
    sent: posted.sent + stored.sent,
    denied: posted.denied + stored.denied,
    failed: posted.failed + stored.failed,
    codes: [posted.codes, stored.codes].filter(Boolean).join("-"),
  };
}

export function parseRefreshHandoff(search: string): RefreshHandoff | null {
  const params = new URLSearchParams(search);
  if (!params.has("sent") && !params.has("denied") && !params.has("failed")) return null;

  return {
    sent: Number(params.get("sent") ?? 0) || 0,
    denied: Number(params.get("denied") ?? 0) || 0,
    failed: Number(params.get("failed") ?? 0) || 0,
    codes: params.get("codes") ?? "",
  };
}

/**
 * What the tracker found after a run's snapshots landed.
 *
 * The scripts post cross-origin with an opaque no-cors request and can only count
 * what they delivered, never what it meant. This is the other half, read back from
 * the server once the import has been stored.
 */
export type RefreshOutcome = {
  /** Unread changes on file after the import. */
  newChanges: number;
  /** When USCIS last moved any case, or null if none has ever moved. */
  lastMovementIso: string | null;
};

export function summarizeOutcome(summary: Summary): RefreshOutcome {
  return {
    newChanges: unreadEntries(summary.cases).length,
    lastMovementIso: lastMovementAt(summary.cases),
  };
}

/**
 * Turns those counts into one honest sentence.
 *
 * Leads with what was read. The first version checked failures first and returned
 * early, so a run that read two cases and skipped the other account's two reported
 * only "2 cases could not be read from USCIS. Sign in again and retry." -- it hid
 * the success and prescribed a fix for a problem that did not exist.
 *
 * A read that stored nothing is the common outcome and used to be indistinguishable
 * from a broken one: "2 cases read." and then a rail that looks exactly as it did
 * before. Saying so, with the date of the last real movement, is the difference
 * between "this works and USCIS is quiet" and "this is not importing".
 * Silence is only claimed when the outcome is known and every read succeeded.
 */
export function describeRefresh(
  handoff: RefreshHandoff,
  outcome: RefreshOutcome | null = null,
): { tone: ToastTone; message: string } {
  const { sent, denied, failed, codes, unstored = 0, added = 0, addedFor, found = 0 } = handoff;

  if (sent === 0 && denied === 0 && failed === 0 && unstored === 0 && found === 0) {
    return {
      tone: "error",
      message: "No cases were found. Sign in to myUSCIS, open the page that lists your cases, then tap refresh again.",
    };
  }

  const parts: string[] = [];
  if (sent > 0) parts.push(`${sent} ${sent === 1 ? "case" : "cases"} read.`);
  else if (found === 0) parts.push("No cases were read.");

  if (added > 0) {
    const owner = addedFor ? ` for ${addedFor}` : "";
    parts.push(added === 1 ? `1 is new and was added${owner}.` : `${added} are new and were added${owner}.`);
  }

  if (found > 0) {
    parts.push(`${found} new ${found === 1 ? "case" : "cases"} found. Choose who ${found === 1 ? "it belongs" : "they belong"} to.`);
  }

  if (denied > 0) {
    parts.push(
      denied === 1
        ? "1 belongs to the other USCIS account — sign in as them and refresh again."
        : `${denied} belong to the other USCIS account — sign in as them and refresh again.`,
    );
  }

  if (failed > 0) {
    const detail = codes ? ` (HTTP ${codes})` : "";
    parts.push(`${failed} could not be read${detail}.`);
  }

  if (unstored > 0) {
    parts.push(`${unstored} came back in a form the tracker could not store.`);
  }

  if (sent > 0 && failed === 0 && unstored === 0 && added === 0 && found === 0 && outcome?.newChanges === 0) {
    parts.push(
      outcome.lastMovementIso
        ? `Nothing new since ${formatShortDay(outcome.lastMovementIso)}.`
        : "Nothing new.",
    );
  }

  return { tone: failed > 0 || unstored > 0 || (sent === 0 && found === 0) ? "error" : "info", message: parts.join(" ") };
}
