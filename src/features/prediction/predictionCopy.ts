// Words for the "Your place in line" card, from the numbers the server sends.
// Pure, so every headline case can be pinned by a test.

import { monthIndex } from "../../../shared/dates";
import { formatMonth } from "../../../shared/predict";
import type { PersonPrediction } from "../../lib/types";

export type Headline =
  | { kind: "current"; title: string; sub: string | null }
  | { kind: "eta"; title: string; sub: string }
  | { kind: "stalled"; title: string; sub: string }
  | { kind: "unknown"; title: string; sub: string };

/** Whole months from `today`'s month to a bulletin month, never below 1. */
export function monthsAhead(month: string, today: Date): number {
  const now = today.getUTCFullYear() * 12 + today.getUTCMonth();
  return Math.max(1, monthIndex(month) - now);
}

const unit = (n: number) => (n === 1 ? "month" : "months");

export function headlineFor(prediction: PersonPrediction, today: Date = new Date()): Headline {
  if (prediction.isCurrent) return { kind: "current", title: "Your date is current", sub: null };

  const { eta } = prediction;
  if (eta) {
    const low = monthsAhead(eta.optimistic, today);
    const high = eta.conservative ? monthsAhead(eta.conservative, today) : null;
    const likely = `most likely ${formatMonth(eta.likely)}`;
    if (high === null) return { kind: "eta", title: `${low}+ ${unit(low)} to go`, sub: likely };
    if (high <= low) return { kind: "eta", title: `About ${low} ${unit(low)} to go`, sub: likely };
    return { kind: "eta", title: `About ${low}–${high} months to go`, sub: likely };
  }

  if (prediction.etaReason === "insufficient_data") {
    return { kind: "unknown", title: "Not enough history yet", sub: prediction.etaNote ?? "Check back after a few more bulletins." };
  }
  return { kind: "stalled", title: "Not moving right now", sub: prediction.etaNote ?? "The cutoff has not advanced recently." };
}

export type DeltaView = { text: string; direction: "up" | "down" | "flat"; tone: "success" | "warning" | "muted" };

const MINUS = "−";

function magnitude(days: number): string {
  const abs = Math.abs(days);
  if (abs >= 60) {
    const months = Math.round(abs / 30.4375);
    return `${months} ${unit(months)}`;
  }
  return `${abs} ${abs === 1 ? "day" : "days"}`;
}

/** "+45 days" up in success, "−3 months" down in warning, "No change" flat. */
export function deltaFor(since: PersonPrediction["sinceLastBulletin"]["finalAction"]): DeltaView | null {
  if (!since) return null;
  switch (since.direction) {
    case "unchanged":
      return { text: "No change", direction: "flat", tone: "muted" };
    case "became_current":
      return { text: "Became current", direction: "up", tone: "success" };
    case "became_unavailable":
      return { text: "Became unavailable", direction: "down", tone: "warning" };
    case "advanced":
      return { text: since.deltaDays === null ? "Advanced" : `+${magnitude(since.deltaDays)}`, direction: "up", tone: "success" };
    case "retrogressed":
      return { text: since.deltaDays === null ? "Retrogressed" : `${MINUS}${magnitude(since.deltaDays)}`, direction: "down", tone: "warning" };
    default:
      return null;
  }
}

/**
 * The explanation, without its own legal-advice sentence: the card prints one
 * disclaimer of its own, and saying it twice reads as nervous.
 */
export function explanationBody(explanation: string): string {
  const sentences = explanation.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()) ?? [explanation];
  const kept = sentences.filter((s) => !/legal advice/i.test(s));
  return (kept.length ? kept : sentences).join(" ");
}

export const CONFIDENCE_LABEL = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" } as const;
