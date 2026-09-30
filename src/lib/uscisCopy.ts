// Plain-language copy the status board needs beyond the shared lifecycle
// registry. Event and notice titles and meanings live in shared/lifecycle.ts;
// this file only adds what the registry does not have: form names, stage
// wording, and the profile pickers. Statuses are never invented here: the
// current status is always the title of a real USCIS entry, and only when there
// is none does a case read as its stage.

import type { Stage } from "../../shared/lifecycle";
import type { CaseSummary, TimelineEntry } from "./types";

const FORM_LABELS: Record<string, string> = {
  "I-485": "Adjustment of status",
  "I-765": "Employment authorization",
  "I-131": "Travel document",
  "I-140": "Immigrant petition for a worker",
  "I-130": "Petition for a relative",
  "I-129": "Petition for a temporary worker",
  "I-539": "Extend or change status",
  "I-90": "Green card replacement",
  "I-751": "Remove conditions on residence",
  "N-400": "Naturalization",
};

/** Short form code for chips: "I-485". */
export function formCode(formType: string | null): string {
  return formType?.trim().toUpperCase().replace(/^([A-Z])(\d)/, "$1-$2") ?? "Case";
}

/** "I-485 · Adjustment of status", or just the code for a form we have no name for. */
export function formLabel(formType: string | null): string {
  if (!formType) return "USCIS case";
  const code = formCode(formType);
  const name = FORM_LABELS[code];
  return name ? `${code} · ${name}` : code;
}

export const STAGE_ORDER: Stage[] = ["filed", "biometrics", "review", "interview", "decision", "card", "closed"];

export const STAGE_COPY: Record<Stage, { label: string; meaning: string }> = {
  filed: { label: "Filed", meaning: "USCIS has your application. The next step is biometrics, if required, or officer review." },
  biometrics: { label: "Biometrics", meaning: "USCIS is collecting fingerprints and running background checks." },
  review: { label: "In review", meaning: "An officer has your file. Nothing for you to do unless USCIS writes to you." },
  interview: { label: "Interview", meaning: "USCIS wants to talk to you before deciding." },
  decision: { label: "Decision", meaning: "USCIS has decided the case. Read the notice." },
  card: { label: "Card", meaning: "Your card is on its way." },
  closed: { label: "Closed", meaning: "USCIS marked this case complete." },
};

export type StatusTone = "forward" | "waiting" | "good" | "bad";

const FORWARD_TAGS = new Set(["review", "biometrics", "interview", "transferred", "rfe_response"]);
const GOOD_TAGS = new Set(["approved", "card_produced", "card_mailed", "card_picked_up", "card_delivered"]);
const BAD_TAGS = new Set(["rfe", "noid", "denied"]);

/** Lime moves forward, ink waits, success is approved, error needs you or is a denial. */
export function toneForTag(tag: string | undefined): StatusTone {
  if (!tag) return "waiting";
  if (BAD_TAGS.has(tag)) return "bad";
  if (GOOD_TAGS.has(tag)) return "good";
  if (FORWARD_TAGS.has(tag)) return "forward";
  return "waiting";
}

/**
 * One plain sentence per lifecycle tag, for the status card. The registry's own
 * meanings are longer and hedged for the history rows; this is the line a person
 * reads first. Keyed by tag, so a new event code only needs a registry entry.
 */
const MEANING_BY_TAG: Record<string, string> = {
  filed: "USCIS has your application. The next step is biometrics, if required, or officer review.",
  biometrics: "USCIS has scheduled your fingerprints and photo. Go to the appointment.",
  review: "An officer has your file. Nothing for you to do unless USCIS writes to you.",
  transferred: "USCIS moved your file to another office. That is routine and not a decision.",
  interview: "USCIS wants to talk to you before it decides. Go to the interview.",
  rfe: "USCIS needs more evidence before it can decide. Respond by the deadline on the notice.",
  rfe_response: "USCIS received your reply and will continue its review.",
  noid: "USCIS intends to deny unless you respond. The deadline is on the notice.",
  approved: "USCIS approved the case. The card is next.",
  denied: "USCIS denied the case. The notice explains why and what you can do.",
  card_produced: "USCIS is printing your card.",
  card_mailed: "USCIS mailed your card.",
  card_picked_up: "The post office has your card.",
  card_delivered: "Your card was delivered.",
};

/** Status strings USCIS words as a sentence, mapped to the same title and tag the event registry uses. */
const STATUS_ALIASES: Record<string, { title: string; tag: string }> = {
  "case is being actively reviewed by uscis": { title: "Actively reviewing", tag: "review" },
};

/** USCIS Title-Cases Its Status Sentences; show them as a sentence, keeping acronyms like USCIS and RFE. */
function sentenceCase(text: string): string {
  const words = text.split(" ");
  if (words.length < 4) return text;
  return words.map((w, i) => (i === 0 || /^[A-Z0-9-]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

export type PresentedEntry = { title: string; meaning: string; tag: string | undefined };

/** How an entry reads: status rows lose their "Status:" prefix and known sentences get the registry's wording. */
export function presentEntry(entry: TimelineEntry): PresentedEntry {
  if (entry.kind === "status") {
    const raw = entry.title.replace(/^Status:\s*/, "");
    const alias = STATUS_ALIASES[raw.toLowerCase()];
    if (alias) return { title: alias.title, meaning: MEANING_BY_TAG[alias.tag] ?? entry.meaning, tag: alias.tag };
    return { title: sentenceCase(raw), meaning: entry.meaning, tag: entry.tag };
  }
  return { title: entry.title, meaning: entry.meaning, tag: entry.tag };
}

export type CaseStatusView = { title: string; meaning: string; tone: StatusTone };

/** What the case status card leads with. The newest real USCIS movement wins. */
export function currentStatus(caseRecord: Pick<CaseSummary, "stage" | "timeline">): CaseStatusView {
  const latest = caseRecord.timeline.find(
    (entry) => entry.source === "uscis" && entry.significance !== "quiet" && entry.kind !== "submission",
  );
  if (latest) {
    const shown = presentEntry(latest);
    return { title: shown.title, meaning: (shown.tag && MEANING_BY_TAG[shown.tag]) || shown.meaning, tone: toneForTag(shown.tag) };
  }
  const { stage } = caseRecord.stage;
  const copy = STAGE_COPY[stage];
  return { title: copy.label, meaning: copy.meaning, tone: stage === "filed" ? "waiting" : "forward" };
}

/** The most recent appointment notice, if the case has one. */
export function latestAppointment(timeline: TimelineEntry[]): TimelineEntry | null {
  return (
    timeline.find((entry) => entry.source === "uscis" && entry.appointmentAt && (entry.tag === "biometrics" || entry.tag === "interview")) ??
    null
  );
}

// ---- profile pickers -------------------------------------------------------

export const CATEGORY_OPTIONS: { value: string; label: string; group: "Employment" | "Family" }[] = [
  { value: "EB1", label: "EB-1 · Priority workers", group: "Employment" },
  { value: "EB2", label: "EB-2 · Advanced degree", group: "Employment" },
  { value: "EB3", label: "EB-3 · Skilled workers", group: "Employment" },
  { value: "EW", label: "EB-3 · Other workers", group: "Employment" },
  { value: "EB4", label: "EB-4 · Special immigrants", group: "Employment" },
  { value: "EB5", label: "EB-5 · Investors", group: "Employment" },
  { value: "F1", label: "F1 · Unmarried adult children of citizens", group: "Family" },
  { value: "F2A", label: "F2A · Spouses and children of green card holders", group: "Family" },
  { value: "F2B", label: "F2B · Unmarried adult children of green card holders", group: "Family" },
  { value: "F3", label: "F3 · Married children of citizens", group: "Family" },
  { value: "F4", label: "F4 · Siblings of citizens", group: "Family" },
  { value: "IR", label: "Immediate relative · no line", group: "Family" },
];

export const COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: "ROW", label: "All other countries" },
  { value: "IN", label: "India" },
  { value: "CN", label: "China" },
  { value: "MX", label: "Mexico" },
  { value: "PH", label: "Philippines" },
  { value: "SV_GT_HN", label: "El Salvador, Guatemala, Honduras" },
  { value: "VN", label: "Vietnam" },
];

/** "EB-2", from the picker label, or the raw code when it is not in the list. */
export function categoryName(category: string | null): string {
  if (!category) return "Not set";
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label.split(" · ")[0] ?? category;
}

export function countryName(chargeability: string | null): string {
  if (!chargeability) return "Not set";
  return COUNTRY_OPTIONS.find((option) => option.value === chargeability)?.label ?? chargeability;
}

export function chartName(chart: "final_action" | "dates_for_filing" | null): string {
  return chart === "dates_for_filing" ? "Dates for filing" : chart === "final_action" ? "Final action" : "Unknown";
}
