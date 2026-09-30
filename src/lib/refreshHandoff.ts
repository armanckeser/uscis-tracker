import { formatShortDay } from "./format";
import { lastMovementAt, unreadEntries } from "./unread";
import type { Summary } from "./types";
import type { ToastTone } from "../hooks/useToast";

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
};

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
  const { sent, denied, failed, codes } = handoff;

  if (sent === 0 && denied === 0 && failed === 0) {
    return { tone: "error", message: "Nothing was delivered. Open USCIS, sign in, then tap refresh again." };
  }

  const parts = [sent > 0 ? `${sent} ${sent === 1 ? "case" : "cases"} read.` : "No cases were read."];

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

  if (sent > 0 && failed === 0 && outcome?.newChanges === 0) {
    parts.push(
      outcome.lastMovementIso
        ? `Nothing new since ${formatShortDay(outcome.lastMovementIso)}.`
        : "Nothing new.",
    );
  }

  return { tone: failed > 0 || sent === 0 ? "error" : "info", message: parts.join(" ") };
}
