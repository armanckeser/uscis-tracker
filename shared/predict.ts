// Visa bulletin availability and the ETA derived from it. Pure and deterministic:
// same inputs, same output, no randomness, no clock except the `today` argument.
// The output is an estimate from past monthly movement. It is not a forecast of
// State Department decisions and not legal advice, and the copy says so.

import { daysBetween, monthFromIndex, monthIndex } from "./dates.js";
import { isImmediateRelative, type ProfileFields } from "./profile.js";

export type Chart = "final_action" | "dates_for_filing";
export type BulletinStatus = "date" | "current" | "unavailable";

export type BulletinRow = {
  /** 'YYYY-MM' */
  bulletin: string;
  chart: Chart;
  kind: string;
  category: string;
  country: string;
  status: BulletinStatus;
  /** YYYY-MM-DD when status is 'date'. */
  date: string | null;
};

export type UscisChartChoice = Record<string, { family?: Chart | null; employment?: Chart | null }>;

export type BulletinData = {
  rows: BulletinRow[];
  uscisChart: UscisChartChoice;
};

export type CutoffPoint = { bulletin: string; status: BulletinStatus; date: string | null };

export type Direction = "advanced" | "retrogressed" | "unchanged" | "became_current" | "became_unavailable";

export type SinceLastBulletin = {
  fromBulletin: string;
  toBulletin: string;
  fromDate: string | null;
  toDate: string | null;
  fromStatus: BulletinStatus;
  toStatus: BulletinStatus;
  /** Null unless both ends are dates. */
  deltaDays: number | null;
  direction: Direction;
};

export type MovementWindow = {
  months: 12 | 24 | 36;
  /** Month-over-month advances where both ends were dates. */
  sampleSize: number;
  medianDaysPerMonth: number | null;
  retrogressions: number;
};

export type EtaMonths = {
  /** 'YYYY-MM' bulletin months. `conservative` is null when the slow quartile shows no forward movement. */
  optimistic: string;
  likely: string;
  conservative: string | null;
  basis: { windowMonths: 24; sampleSize: number; daysPerMonth: { p25: number; median: number; p75: number } };
};

export type EtaReason = "current" | "no_forward_movement" | "insufficient_data" | "unavailable";

export type Confidence = "low" | "medium" | "high";

export type PredictionStatus = "ok" | "needs_profile" | "no_queue" | "no_data";

export type PersonPrediction = {
  status: PredictionStatus;
  /** Profile fields still needed when status is needs_profile. */
  missing: string[];
  category: string | null;
  chargeability: string | null;
  priorityDate: string | null;
  /** Latest bulletin month present for this category and country. */
  latestBulletin: string | null;
  chartInUse: Chart | null;
  chartSource: "uscis" | "default" | null;
  current: { finalAction: CutoffPoint | null; datesForFiling: CutoffPoint | null };
  isCurrent: boolean | null;
  canFile: boolean | null;
  /** Priority date minus the FAD cutoff, in days. 0 when current. Null when unknowable. */
  gapDays: number | null;
  sinceLastBulletin: { finalAction: SinceLastBulletin | null; datesForFiling: SinceLastBulletin | null };
  movement: MovementWindow[];
  eta: EtaMonths | null;
  etaReason: EtaReason | null;
  etaNote: string | null;
  confidence: Confidence | null;
  explanation: string;
};

export const CURRENT_NOTE = "Your date is current. A decision can come any time once USCIS finishes review.";
export const MIN_ETA_SAMPLES = 6;
const ETA_WINDOW = 24;

// ---------------------------------------------------------------- series

const CATEGORY_ALIASES: Record<string, string[]> = {
  EW: ["EW", "EB3W", "OW", "EB3_OTHER_WORKERS"],
  EB5: ["EB5", "EB5_UNRESERVED", "EB5_NON_RESERVED"],
};

export function categoryCandidates(category: string): string[] {
  const c = category.trim().toUpperCase();
  return CATEGORY_ALIASES[c] ?? [c];
}

export function isFamilyCategory(category: string): boolean {
  return /^F[1-4]/.test(category.trim().toUpperCase());
}

/**
 * Countries the dataset names explicitly fall back to nothing; chargeability the
 * dataset never names is "all other countries" and reads the ROW rows. Never
 * falls through to ROW for a country the data does cover, or a missing series
 * would silently borrow the wrong queue.
 */
export function countryCandidates(chargeability: string, rows: BulletinRow[]): string[] {
  const c = chargeability.trim().toUpperCase();
  if (c === "ROW" || c === "ALL") return ["ROW", "ALL"];
  if (rows.some((row) => row.country.toUpperCase() === c)) return [c];
  return ["ROW", "ALL"];
}

/** One (chart, category, country) series, oldest to newest, one point per bulletin. */
export function selectSeries(rows: BulletinRow[], chart: Chart, category: string, chargeability: string): CutoffPoint[] {
  const countries = countryCandidates(chargeability, rows);
  const categories = categoryCandidates(category);
  for (const cat of categories) {
    for (const country of countries) {
      const points = new Map<string, CutoffPoint>();
      for (const row of rows) {
        if (row.chart !== chart || row.category.toUpperCase() !== cat || row.country.toUpperCase() !== country) continue;
        points.set(row.bulletin, { bulletin: row.bulletin, status: row.status, date: row.status === "date" ? row.date : null });
      }
      if (points.size) return [...points.values()].sort((a, b) => a.bulletin.localeCompare(b.bulletin));
    }
  }
  return [];
}

// ---------------------------------------------------------------- movement

/** Month-over-month FAD change in days, only where both consecutive months are dates. */
export function monthlyAdvances(series: CutoffPoint[]): { bulletin: string; deltaDays: number }[] {
  const out: { bulletin: string; deltaDays: number }[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const curr = series[i];
    if (prev.date === null || curr.date === null) continue;
    if (monthIndex(curr.bulletin) - monthIndex(prev.bulletin) !== 1) continue;
    out.push({ bulletin: curr.bulletin, deltaDays: daysBetween(prev.date, curr.date) });
  }
  return out;
}

/** Linear-interpolated quantile of a numeric sample. Deterministic. */
export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function windowAdvances(advances: { bulletin: string; deltaDays: number }[], latest: string, months: number) {
  const floor = monthIndex(latest) - months;
  return advances.filter((a) => monthIndex(a.bulletin) > floor);
}

export function movementWindows(series: CutoffPoint[]): MovementWindow[] {
  const latest = series.at(-1)?.bulletin;
  const advances = monthlyAdvances(series);
  return ([12, 24, 36] as const).map((months) => {
    const sample = latest ? windowAdvances(advances, latest, months) : [];
    return {
      months,
      sampleSize: sample.length,
      medianDaysPerMonth: sample.length ? quantile(sample.map((a) => a.deltaDays), 0.5) : null,
      retrogressions: sample.filter((a) => a.deltaDays < 0).length,
    };
  });
}

/**
 * Net cutoff advance per month over the trailing window: (last dated cutoff − first dated cutoff) / months between.
 * Cutoffs move in rare jumps, so most monthly deltas are 0 and a median of them reads as "not moving"
 * even when the date advanced years. The net rate captures the jumps.
 */
export function netDaysPerMonth(series: CutoffPoint[], months: number): number | null {
  const latest = series.at(-1)?.bulletin;
  if (!latest) return null;
  const start = monthIndex(latest) - months;
  const dated = series.filter((p) => p.status === "date" && p.date && monthIndex(p.bulletin) >= start);
  if (dated.length < 2) return null;
  const first = dated[0];
  const last = dated.at(-1)!;
  const span = monthIndex(last.bulletin) - monthIndex(first.bulletin);
  if (span < Math.min(6, months / 2)) return null;
  return daysBetween(first.date!, last.date!) / span;
}

export function compareLastTwo(series: CutoffPoint[]): SinceLastBulletin | null {
  if (series.length < 2) return null;
  const from = series.at(-2)!;
  const to = series.at(-1)!;
  const base = {
    fromBulletin: from.bulletin,
    toBulletin: to.bulletin,
    fromDate: from.date,
    toDate: to.date,
    fromStatus: from.status,
    toStatus: to.status,
  };
  if (to.status === "unavailable") {
    return { ...base, deltaDays: null, direction: from.status === "unavailable" ? "unchanged" : "became_unavailable" };
  }
  if (to.status === "current") {
    return { ...base, deltaDays: null, direction: from.status === "current" ? "unchanged" : "became_current" };
  }
  // `to` is a date from here.
  if (from.status === "current") return { ...base, deltaDays: null, direction: "retrogressed" };
  if (from.status === "unavailable") return { ...base, deltaDays: null, direction: "advanced" };
  const delta = daysBetween(from.date!, to.date!);
  return { ...base, deltaDays: delta, direction: delta > 0 ? "advanced" : delta < 0 ? "retrogressed" : "unchanged" };
}

// ---------------------------------------------------------------- prediction

function pointOn(point: CutoffPoint | undefined, priorityDate: string): boolean {
  if (!point) return false;
  if (point.status === "current") return true;
  return point.status === "date" && point.date !== null && priorityDate <= point.date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function empty(status: PredictionStatus, profile: ProfileFields, explanation: string, missing: string[] = []): PersonPrediction {
  return {
    status,
    missing,
    category: profile.category,
    chargeability: profile.chargeability,
    priorityDate: profile.priorityDate,
    latestBulletin: null,
    chartInUse: null,
    chartSource: null,
    current: { finalAction: null, datesForFiling: null },
    isCurrent: null,
    canFile: null,
    gapDays: null,
    sinceLastBulletin: { finalAction: null, datesForFiling: null },
    movement: [],
    eta: null,
    etaReason: null,
    etaNote: null,
    confidence: null,
    explanation,
  };
}

function chartFor(category: string, latestBulletin: string, uscisChart: UscisChartChoice): { chart: Chart; source: "uscis" | "default" } {
  const family = isFamilyCategory(category);
  const chosen = uscisChart[latestBulletin]?.[family ? "family" : "employment"];
  if (chosen === "final_action" || chosen === "dates_for_filing") return { chart: chosen, source: "uscis" };
  return { chart: family ? "dates_for_filing" : "final_action", source: "default" };
}

function confidenceOf(windowSample: number[], retrogressions: number): Confidence {
  if (windowSample.length < 12 || retrogressions >= 3) return "low";
  const p25 = quantile(windowSample, 0.25);
  const p75 = quantile(windowSample, 0.75);
  const median = quantile(windowSample, 0.5);
  const volatility = (p75 - p25) / Math.max(Math.abs(median), 1);
  if (volatility > 3) return "low";
  if (retrogressions === 0 && windowSample.length >= 18 && volatility <= 1.5) return "high";
  return "medium";
}

/**
 * Where a person's priority date stands against the visa bulletin and when the
 * final action cutoff might reach it. `profile` is the effective profile (a
 * derivative's already resolved from its principal).
 */
export function predictForPerson(profile: ProfileFields, bulletins: BulletinData, _today: Date | string): PersonPrediction {
  if (isImmediateRelative(profile.category)) {
    return empty("no_queue", profile, "Immediate relatives have no visa queue, so there is no priority date to wait on.");
  }
  const missing = (["category", "chargeability", "priorityDate"] as const).filter((field) => !profile[field]);
  if (missing.length) {
    return empty("needs_profile", profile, "Add a category, chargeability and priority date to see where you stand against the visa bulletin.", missing);
  }
  const category = profile.category!;
  const chargeability = profile.chargeability!;
  const priorityDate = profile.priorityDate!;

  const fad = selectSeries(bulletins.rows, "final_action", category, chargeability);
  const dff = selectSeries(bulletins.rows, "dates_for_filing", category, chargeability);
  if (fad.length === 0 && dff.length === 0) {
    return empty("no_data", profile, `No visa bulletin data for ${category} ${chargeability} has been loaded yet.`);
  }

  const latestBulletin = [...fad, ...dff].map((p) => p.bulletin).sort().at(-1)!;
  const { chart: chartInUse, source: chartSource } = chartFor(category, latestBulletin, bulletins.uscisChart);
  const currentFad = fad.at(-1);
  const currentDff = dff.at(-1);
  const chartPoint = chartInUse === "final_action" ? currentFad : currentDff;

  const isCurrent = pointOn(currentFad, priorityDate);
  const canFile = pointOn(chartPoint, priorityDate);
  // "Unavailable" is usually the end of a fiscal year, not a reset: measure from the last published cutoff.
  const unavailableNow = currentFad?.status === "unavailable";
  const reference = currentFad?.status === "date" ? currentFad : unavailableNow ? [...fad].reverse().find((p) => p.status === "date" && p.date) : undefined;
  let gapDays: number | null = null;
  if (isCurrent) gapDays = 0;
  else if (reference?.date) gapDays = daysBetween(reference.date, priorityDate);

  const movement = movementWindows(fad);
  const advances = monthlyAdvances(fad);
  const sample24 = windowAdvances(advances, fad.at(-1)?.bulletin ?? latestBulletin, ETA_WINDOW).map((a) => a.deltaDays);
  const retro24 = sample24.filter((d) => d < 0).length;

  let eta: EtaMonths | null = null;
  let etaReason: EtaReason | null = null;
  let etaNote: string | null = null;

  if (isCurrent) {
    etaReason = "current";
    etaNote = CURRENT_NOTE;
  } else if (gapDays === null) {
    etaReason = "unavailable";
    etaNote = "The final action date is unavailable this month, so there is nothing to project from.";
  } else if (sample24.length < MIN_ETA_SAMPLES) {
    etaReason = "insufficient_data";
    etaNote = `Only ${sample24.length} usable months of movement are on file, which is too few to project from.`;
  } else {
    const rates = [12, 24, 36].map((m) => netDaysPerMonth(fad, m)).filter((r): r is number => r !== null);
    const median = netDaysPerMonth(fad, ETA_WINDOW) ?? (rates.length ? rates[Math.floor(rates.length / 2)] : 0);
    const p75 = rates.length ? Math.max(median, ...rates) : median;
    const p25 = rates.length ? Math.min(median, ...rates) : median;
    if (median <= 0) {
      etaReason = "no_forward_movement";
      etaNote = "The cutoff has not moved forward over the last 24 months, so no arrival month can be projected.";
    } else {
      const from = latestBulletin;
      const at = (pace: number) => monthFromIndex(monthIndex(from) + Math.ceil(gapDays! / pace));
      const conservativeMonths = p25 > 0 ? Math.ceil(gapDays / p25) : Infinity;
      eta = {
        optimistic: at(p75),
        likely: at(median),
        conservative: conservativeMonths > 1200 ? null : at(p25),
        basis: { windowMonths: ETA_WINDOW, sampleSize: sample24.length, daysPerMonth: { p25, median, p75 } },
      };
    }
  }

  const confidence: Confidence = isCurrent ? "high" : eta === null ? "low" : confidenceOf(sample24, retro24);

  const sinceFad = compareLastTwo(fad);
  const sinceDff = compareLastTwo(dff);
  const cutoffText = (p?: CutoffPoint) => (p?.status === "date" && p.date ? formatDay(p.date) : p?.status === "current" ? "current" : "unavailable");
  const label = `${category} ${chargeability}`;
  const parts: string[] = [];
  if (isCurrent) {
    parts.push(`Your priority date of ${formatDay(priorityDate)} is on or before the final action cutoff (${cutoffText(currentFad)}) for ${label} in the ${formatMonth(latestBulletin)} bulletin, so a visa number is available for you.`);
    parts.push(CURRENT_NOTE);
  } else {
    const cutoffWords = unavailableNow && reference ? `the last published final action cutoff of ${cutoffText(reference)} (${formatMonth(reference.bulletin)}; this month it is unavailable, which usually happens late in the fiscal year)` : `the final action cutoff of ${cutoffText(currentFad)}`;
    const gapText = gapDays === null ? "" : ` It is ${gapDays} days (about ${Math.round(gapDays / 30.4375)} months) behind ${cutoffWords}.`;
    parts.push(`Your priority date of ${formatDay(priorityDate)} is not current for ${label} in the ${formatMonth(latestBulletin)} bulletin.${gapText}`);
    if (eta) {
      const m = eta.basis.daysPerMonth.median;
      parts.push(
        `The cutoff advanced a net ${Math.round(m)} days a month over the last 24 months` +
          `${retro24 ? ` (with ${retro24} retrogression${retro24 === 1 ? "" : "s"})` : ""}; at that pace it reaches your date around ${formatMonth(eta.likely)}` +
          (eta.optimistic !== eta.likely ? `, sooner as early as ${formatMonth(eta.optimistic)}` : "") +
          (eta.conservative === null
            ? ", with no arrival month projected at the slower pace"
            : eta.conservative !== eta.likely ? `${eta.optimistic !== eta.likely ? " or" : ","} later by ${formatMonth(eta.conservative)}` : "") +
          ".",
      );
      parts.push("This is an estimate from past movement, not a prediction of future bulletins or legal advice.");
    } else {
      parts.push(`${etaNote} This is an estimate from past movement, not legal advice.`);
    }
  }

  return {
    status: "ok",
    missing: [],
    category,
    chargeability,
    priorityDate,
    latestBulletin,
    chartInUse,
    chartSource,
    current: { finalAction: currentFad ?? null, datesForFiling: currentDff ?? null },
    isCurrent,
    canFile,
    gapDays,
    sinceLastBulletin: { finalAction: sinceFad, datesForFiling: sinceDff },
    movement,
    eta,
    etaReason,
    etaNote,
    confidence,
    explanation: parts.join(" "),
  };
}

/** A push-worthy sentence when the newest bulletin moved this person's cutoffs, else null. */
export function bulletinChangeNotice(prediction: PersonPrediction): { title: string; body: string } | null {
  if (prediction.status !== "ok") return null;
  const moves: string[] = [];
  const describe = (name: string, s: SinceLastBulletin | null) => {
    if (!s || s.direction === "unchanged") return;
    const detail =
      s.direction === "became_current" ? "became current"
      : s.direction === "became_unavailable" ? "became unavailable"
      : s.deltaDays !== null ? `${s.direction} ${Math.abs(s.deltaDays)} days to ${formatDay(s.toDate!)}`
      : s.direction === "retrogressed" ? "retrogressed" : "advanced";
    moves.push(`${name} ${detail}`);
  };
  describe("Final action date", prediction.sinceLastBulletin.finalAction);
  describe("Dates for filing", prediction.sinceLastBulletin.datesForFiling);
  if (moves.length === 0) return null;
  const label = `${prediction.category} ${prediction.chargeability}`;
  return {
    title: `Visa bulletin: ${label} moved`,
    body: `${moves.join("; ")}.${prediction.isCurrent ? " Your priority date is current." : ""}`,
  };
}
