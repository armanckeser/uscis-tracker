// What to expect for one case: a decision window from USCIS's published
// processing times, combined with visa availability for the I-485. Pure.

import { addMonthsToDate, daysBetween, toIsoDate } from "./dates.js";
import { formatDay, formatMonth, type PersonPrediction } from "./predict.js";
import type { ProfileFields } from "./profile.js";

export type ProcessingTimeRow = {
  /** YYYY-MM-DD */
  snapshotDate: string;
  form: string;
  formCategory: string;
  office: string;
  rangeLowMonths: number | null;
  rangeHighMonths: number | null;
  /** 'months' (default), 'weeks' or 'days'. */
  unit: string;
};

export type CaseFacts = {
  formType: string | null;
  receiptNumber: string;
  /** ISO instant USCIS recorded the filing, when known. */
  submissionAt: string | null;
  /** Latest occurredAt of a uscis-source change. */
  lastUscisMovementAt: string | null;
  closed: boolean | null;
};

export type ExpectationWindow = {
  from: string;
  to: string;
  basis: "uscis_processing_times" | "visa_availability_plus_processing_times";
  snapshotDate: string;
  /** The office the range came from, or null for the national figure. */
  office: string | null;
  rangeMonths: { low: number; high: number };
};

export type CaseExpectation = {
  kind: "processing_time" | "visa_availability" | "none";
  window: ExpectationWindow | null;
  /** True when today is past the end of the window. */
  pastWindow: boolean;
  reason: string | null;
  summary: string;
  filedOn: string | null;
  timeSinceFiledDays: number | null;
  timeSinceLastMovementDays: number | null;
};

/** Receipt prefix to the office name fragment used in the processing-times dataset. IOE is online filing: no office. */
const PREFIX_OFFICES: Record<string, string> = {
  SRC: "texas",
  LIN: "nebraska",
  EAC: "vermont",
  WAC: "california",
  MSC: "national benefits",
  NBC: "national benefits",
  YSC: "potomac",
};

export function officeForReceipt(receiptNumber: string): string | null {
  return PREFIX_OFFICES[receiptNumber.slice(0, 3).toUpperCase()] ?? null;
}

function toMonths(value: number, unit: string): number {
  const u = unit.trim().toLowerCase();
  if (u.startsWith("week")) return value / 4.345;
  if (u.startsWith("day")) return value / 30.4375;
  return value;
}

function normForm(form: string): string {
  return form.replace(/[\s-]/g, "").toUpperCase();
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type ProcessingRange = { low: number; high: number; snapshotDate: string; office: string | null };

/**
 * The range for a form from the newest snapshot: the case's own office when the
 * receipt prefix names one and the data has it, else the national row, else the
 * median across offices.
 */
export function processingRange(formType: string, receiptNumber: string, profile: ProfileFields | null, rows: ProcessingTimeRow[]): ProcessingRange | null {
  const matching = rows.filter((r) => normForm(r.form) === normForm(formType) && r.rangeLowMonths !== null && r.rangeHighMonths !== null);
  if (matching.length === 0) return null;
  const newest = matching.map((r) => r.snapshotDate).sort().at(-1)!;
  let pool = matching.filter((r) => r.snapshotDate === newest);

  // The I-485 has separate employment and family ranges.
  const wanted = /^F/.test(profile?.category ?? "") ? /family/i : profile?.category ? /employ/i : null;
  if (wanted) {
    const narrowed = pool.filter((r) => wanted.test(r.formCategory));
    if (narrowed.length) pool = narrowed;
  }

  const fragment = officeForReceipt(receiptNumber);
  const own = fragment ? pool.filter((r) => r.office.toLowerCase().includes(fragment)) : [];
  const national = pool.filter((r) => /^(national|nationwide|all|us|usa)\b/i.test(r.office.trim()));
  const chosen = own.length ? own : national.length ? national : pool;
  const office = own.length ? own[0].office : null;

  const lows = chosen.map((r) => toMonths(r.rangeLowMonths!, r.unit));
  const highs = chosen.map((r) => toMonths(r.rangeHighMonths!, r.unit));
  return { low: median(lows), high: median(highs), snapshotDate: newest, office };
}

const NON_QUEUE_FORMS = new Set(["I765", "I131", "I140", "I130"]);

function windowFrom(filedOn: string, range: ProcessingRange): ExpectationWindow {
  return {
    from: addMonthsToDate(filedOn, range.low),
    to: addMonthsToDate(filedOn, range.high),
    basis: "uscis_processing_times",
    snapshotDate: range.snapshotDate,
    office: range.office,
    rangeMonths: { low: range.low, high: range.high },
  };
}

function rangeText(range: ProcessingRange): string {
  const r = (n: number) => (Math.round(n * 10) / 10).toString();
  return `${r(range.low)} to ${r(range.high)} months`;
}

export function predictForCase(
  caseFacts: CaseFacts,
  profile: ProfileFields | null,
  processingTimes: ProcessingTimeRow[],
  prediction: PersonPrediction | null,
  today: Date | string,
): CaseExpectation {
  const todayDate = toIsoDate(today);
  const filedOn = caseFacts.submissionAt ? caseFacts.submissionAt.slice(0, 10) : null;
  const base = {
    filedOn,
    timeSinceFiledDays: filedOn ? Math.max(0, daysBetween(filedOn, todayDate)) : null,
    timeSinceLastMovementDays: caseFacts.lastUscisMovementAt ? Math.max(0, daysBetween(caseFacts.lastUscisMovementAt, todayDate)) : null,
  };
  const none = (reason: string, summary: string): CaseExpectation => ({ ...base, kind: "none", window: null, pastWindow: false, reason, summary });

  if (caseFacts.closed) return none("closed", "USCIS has closed this case.");
  const form = caseFacts.formType;
  if (!form) return none("unknown_form", "The form type is not known yet.");
  if (!filedOn) return none("no_filing_date", "USCIS has not reported a filing date for this case yet.");

  const range = processingRange(form, caseFacts.receiptNumber, profile, processingTimes);
  const isI485 = normForm(form) === "I485";

  if (isI485 && prediction?.status === "ok" && prediction.isCurrent === false) {
    const eta = prediction.eta;
    if (eta && range) {
      const from = addMonthsToDate(`${eta.optimistic}-01`, range.low);
      const to = addMonthsToDate(`${eta.conservative ?? eta.likely}-01`, range.high);
      return {
        ...base,
        kind: "visa_availability",
        window: { from, to, basis: "visa_availability_plus_processing_times", snapshotDate: range.snapshotDate, office: range.office, rangeMonths: { low: range.low, high: range.high } },
        pastWindow: todayDate > to,
        reason: null,
        summary: `A decision needs a visa number first. If the cutoff keeps moving as it has, your date could be current around ${formatMonth(eta.likely)}, then USCIS typically takes ${rangeText(range)}.`,
      };
    }
    return {
      ...base,
      kind: "visa_availability",
      window: null,
      pastWindow: false,
      reason: prediction.etaReason ?? "not_current",
      summary: "A decision needs a visa number first, and your priority date is not current yet. There is not enough bulletin movement to project when it will be.",
    };
  }

  if (!range) {
    return none("no_processing_times", NON_QUEUE_FORMS.has(normForm(form)) || isI485 ? "USCIS processing times for this form are not loaded yet." : "No processing-time range is available for this form.");
  }

  const window = windowFrom(filedOn, range);
  const pastWindow = todayDate > window.to;
  const where = range.office ? `${range.office}` : "the national range";
  let summary = `USCIS reports ${rangeText(range)} for ${form} (${where}, as of ${formatDay(range.snapshotDate)}). Counting from ${formatDay(filedOn)}, that is ${formatDay(window.from)} to ${formatDay(window.to)}.`;
  if (pastWindow) summary += " This case is past that window, which is common and not a sign of a problem by itself.";
  if (isI485 && (!prediction || prediction.status !== "ok")) summary += " This assumes your priority date is current; add your profile to check.";
  return { ...base, kind: "processing_time", window, pastWindow, reason: null, summary };
}
