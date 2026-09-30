// Single source of truth for how USCIS case movement is presented.
//
// USCIS exposes movement as two kinds of records on the case-service API:
// notices (`notices[].actionType`) and internal events (`events[].eventCode`).
// Those strings are shared across form types (I-485, I-765, I-131, ...) because
// they come from one ELIS event log, so a single registry keyed on the string
// covers every case. A new notice or event kind that USCIS starts emitting only
// needs one entry added here, not changes spread across the UI.
//
// The API reliably carries a notice's datetime (`appointmentDateTime`) and
// generation date, but never the things a human reads off the paper I-797: the
// appointment/interview address, an RFE/NOID response deadline, a card tracking
// number. Each registry entry therefore declares the `fillable` fields a human
// can enter for that notice; those values are stored per-letterId server-side
// and merged back in at render time. See [[project_uscis_i485_lifecycle]].

/** A piece of information the API omits that the user can fill in from the paper notice. */
export type FillableField = {
  key: string;
  label: string;
  placeholder: string;
  /** "address" fields get a map link; "date" fields render as a date; "text" is freeform. */
  kind: "address" | "date" | "text";
};

export type LifecycleTone = "neutral" | "info" | "action" | "good" | "bad";

/** Where a case sits. Ordered: a case only ever moves right (see deriveStage). */
export const STAGES = ["filed", "biometrics", "review", "interview", "decision", "card", "closed"] as const;
export type Stage = (typeof STAGES)[number];

/** How loudly an entry should speak. milestone and step notify; quiet never does. */
export type Significance = "milestone" | "step" | "quiet";

/** What an entry means for the case, independent of its wording. */
export type LifecycleTag =
  | "filed"
  | "biometrics"
  | "interview"
  | "rfe"
  | "rfe_response"
  | "noid"
  | "review"
  | "transferred"
  | "approved"
  | "denied"
  | "card_produced"
  | "card_mailed"
  | "card_picked_up"
  | "card_delivered";

/** How a known notice/event kind should read in the timeline. */
export type LifecycleEntry = {
  title: string;
  /** One-sentence plain explanation shown when the row is expanded. */
  detail: string;
  tone: LifecycleTone;
  /** True for notices that carry an `appointmentDateTime` the user should see and add to a calendar. */
  isAppointment?: boolean;
  /** User-fillable fields the API does not provide for this kind. */
  fillable?: FillableField[];
  significance: Significance;
  /** The stage this entry moves the case into, when it moves it at all. */
  stage?: Stage;
  tag?: LifecycleTag;
};

const APPOINTMENT_LOCATION: FillableField = {
  key: "address",
  label: "Location",
  placeholder: "Address from your appointment notice",
  kind: "address",
};

const APPOINTMENT_NOTE: FillableField = {
  key: "note",
  label: "Note",
  placeholder: "Anything to bring or remember",
  kind: "text",
};

const RESPONSE_DEADLINE: FillableField = {
  key: "dueDate",
  label: "Response deadline",
  placeholder: "Deadline printed on the notice",
  kind: "date",
};

const TRACKING_NUMBER: FillableField = {
  key: "tracking",
  label: "Tracking number",
  placeholder: "USPS tracking number",
  kind: "text",
};

// Keyed by the exact `actionType` string USCIS sends. Matching is
// case-insensitive and also tolerant of the close variants seen in the wild
// (see resolveNoticeKey). Values are the forum/observed strings, treated as
// likely-not-canonical: anything not here still renders via the raw fallback.
const NOTICE_REGISTRY: Record<string, LifecycleEntry> = {
  "appointment scheduled": {
    title: "Appointment scheduled",
    significance: "milestone",
    stage: "biometrics",
    tag: "biometrics",
    detail: "USCIS scheduled an appointment. The notice carries the date and time; the location comes from the paper notice you can add below.",
    tone: "action",
    isAppointment: true,
    fillable: [APPOINTMENT_LOCATION, APPOINTMENT_NOTE],
  },
  "biometrics appointment was scheduled": {
    title: "Biometrics appointment scheduled",
    significance: "milestone",
    stage: "biometrics",
    tag: "biometrics",
    detail: "USCIS scheduled your biometrics (fingerprints and photo) at an Application Support Center. Add the ASC address from your paper notice.",
    tone: "action",
    isAppointment: true,
    fillable: [APPOINTMENT_LOCATION, APPOINTMENT_NOTE],
  },
  "interview was scheduled": {
    title: "Interview scheduled",
    significance: "milestone",
    stage: "interview",
    tag: "interview",
    detail: "USCIS scheduled an interview at a field office. The notice carries the date and time; add the field office address from your paper notice.",
    tone: "action",
    isAppointment: true,
    fillable: [APPOINTMENT_LOCATION, APPOINTMENT_NOTE],
  },
  "request for evidence was sent": {
    title: "Request for evidence (RFE)",
    significance: "milestone",
    stage: "review",
    tag: "rfe",
    detail: "USCIS asked for more evidence. The deadline and what is requested are only on the paper notice. Record the response deadline below.",
    tone: "action",
    fillable: [RESPONSE_DEADLINE, APPOINTMENT_NOTE],
  },
  "response to request for evidence was received": {
    title: "RFE response received",
    significance: "step",
    stage: "review",
    tag: "rfe_response",
    detail: "USCIS recorded receiving your response to the request for evidence.",
    tone: "good",
  },
  "notice of intent to deny was sent": {
    title: "Notice of intent to deny (NOID)",
    significance: "milestone",
    stage: "review",
    tag: "noid",
    detail: "USCIS intends to deny unless you respond. The reasons and deadline are only on the paper notice. Record the deadline below.",
    tone: "bad",
    fillable: [RESPONSE_DEADLINE, APPOINTMENT_NOTE],
  },
  "case was received": {
    title: "Case received",
    detail: "USCIS received the application and opened the case.",
    tone: "info",
    significance: "milestone",
    stage: "filed",
    tag: "filed",
  },
  "case was transferred": {
    title: "Case transferred",
    detail: "USCIS moved the case to another office. This is routine workload balancing, not a decision.",
    tone: "neutral",
    significance: "step",
    stage: "review",
    tag: "transferred",
  },
  "case was denied": {
    title: "Case denied",
    detail: "USCIS denied the case. The paper notice is the source of truth for the reason and any appeal or motion deadline.",
    tone: "bad",
    significance: "milestone",
    stage: "decision",
    tag: "denied",
  },
  "receipt notice was sent": {
    title: "Receipt notice sent",
    significance: "milestone",
    stage: "filed",
    tag: "filed",
    detail: "USCIS confirmed it received the case and mailed a receipt notice.",
    tone: "info",
  },
  "new card is being produced": {
    title: "Card is being produced",
    significance: "milestone",
    stage: "card",
    tag: "card_produced",
    detail: "USCIS approved the case and is producing the card or document.",
    tone: "good",
  },
  "case was approved": {
    title: "Case approved",
    significance: "milestone",
    stage: "decision",
    tag: "approved",
    detail: "USCIS approved the case.",
    tone: "good",
  },
  "card was mailed to me": {
    title: "Card mailed",
    significance: "milestone",
    stage: "card",
    tag: "card_mailed",
    detail: "USCIS mailed the card or document. Add the USPS tracking number from your notice to follow it.",
    tone: "good",
    fillable: [TRACKING_NUMBER],
  },
  "card was picked up by the united states postal service": {
    title: "Card picked up by USPS",
    significance: "step",
    stage: "card",
    tag: "card_picked_up",
    detail: "USPS picked up the card from USCIS for delivery.",
    tone: "info",
  },
  "card was delivered to me by the post office": {
    title: "Card delivered",
    significance: "milestone",
    stage: "card",
    tag: "card_delivered",
    detail: "USPS delivered the card or document.",
    tone: "good",
  },
};

// Keyed by `eventCode`. These are internal USCIS codes with no published
// meaning; the descriptions are community-derived and deliberately cautious.
const EVENT_REGISTRY: Record<string, LifecycleEntry> = {
  IAF: {
    title: "Application filed",
    significance: "milestone",
    stage: "filed",
    tag: "filed",
    detail: "USCIS recorded the application in its system. This marks intake, not a decision.",
    tone: "info",
  },
  IMAG: {
    title: "Biometrics scheduled",
    significance: "milestone",
    stage: "biometrics",
    tag: "biometrics",
    detail: "USCIS scheduled a biometrics appointment. The appointment notice carries the date.",
    tone: "action",
  },
  FTA0: {
    title: "Actively reviewing",
    significance: "step",
    stage: "review",
    tag: "review",
    detail: "An officer-level review step. USCIS does not publish a precise meaning, so treat it as movement, not a decision. It often appears in pairs around biometrics and background checks.",
    tone: "neutral",
  },
  FTA1: {
    title: "Supervisor review",
    significance: "step",
    stage: "review",
    tag: "review",
    detail: "A supervisory review step. Treat it as movement rather than a decision.",
    tone: "neutral",
  },
  SA: {
    title: "Status adjusted",
    significance: "step",
    detail: "USCIS adjusted the case status, often around an approval. Rely on the visible status and any notice as the real evidence.",
    tone: "good",
  },
  H008: {
    title: "Case approved",
    significance: "milestone",
    stage: "decision",
    tag: "approved",
    detail: "An approval code. Rely on the visible status and approval notice as the real evidence.",
    tone: "good",
  },
  H016: {
    title: "Case terminated",
    significance: "milestone",
    stage: "decision",
    tag: "denied",
    detail: "A termination/denial code. The paper notice is the source of truth for the reason and any next step.",
    tone: "bad",
  },
  LEE: {
    title: "Card picked up by USPS",
    significance: "step",
    stage: "card",
    tag: "card_picked_up",
    detail: "USPS picked up the card from USCIS for delivery.",
    tone: "info",
  },
  LED: {
    title: "Card delivered",
    significance: "milestone",
    stage: "card",
    tag: "card_delivered",
    detail: "USPS delivered the card or document.",
    tone: "good",
  },
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolves a notice's actionType to a registry entry. Matching is
 * case-insensitive and tolerant of the small wording variants USCIS uses for
 * the same action (e.g. "Appointment Scheduled" vs "Biometrics Appointment Was
 * Scheduled"). Returns null for anything unknown so the caller can fall back to
 * showing the raw string rather than guessing a meaning.
 */
export function lookupNotice(actionType: string | null | undefined): LifecycleEntry | null {
  if (!actionType) return null;
  const key = normalize(actionType);
  if (NOTICE_REGISTRY[key]) return NOTICE_REGISTRY[key];

  // Tolerant fallbacks for close wording: any "appointment ... scheduled" is an
  // appointment; "request for evidence ... sent" is an RFE; card phrases map to
  // the card lifecycle. This keeps near-miss strings first-class without an
  // exhaustive list.
  if (key.includes("appointment") && key.includes("scheduled")) return NOTICE_REGISTRY["appointment scheduled"];
  if (key.includes("interview") && key.includes("scheduled")) return NOTICE_REGISTRY["interview was scheduled"];
  if (key.includes("intent to deny")) return NOTICE_REGISTRY["notice of intent to deny was sent"];
  if (key.includes("request for evidence") && key.includes("received")) return NOTICE_REGISTRY["response to request for evidence was received"];
  if (key.includes("request for evidence")) return NOTICE_REGISTRY["request for evidence was sent"];
  if (key.includes("card") && key.includes("delivered")) return NOTICE_REGISTRY["card was delivered to me by the post office"];
  if (key.includes("card") && key.includes("picked up")) return NOTICE_REGISTRY["card was picked up by the united states postal service"];
  if (key.includes("card") && key.includes("mailed")) return NOTICE_REGISTRY["card was mailed to me"];
  if (key.includes("card") && key.includes("produced")) return NOTICE_REGISTRY["new card is being produced"];
  if (key.includes("approved")) return NOTICE_REGISTRY["case was approved"];
  if (key.includes("denied")) return NOTICE_REGISTRY["case was denied"];
  if (key.includes("transferred")) return NOTICE_REGISTRY["case was transferred"];
  if (key.includes("was received") || key.includes("receipt notice")) return NOTICE_REGISTRY["case was received"];
  return null;
}

/** Resolves an eventCode to a registry entry, or null for unknown codes. */
export function lookupEvent(eventCode: string | null | undefined): LifecycleEntry | null {
  if (!eventCode) return null;
  return EVENT_REGISTRY[eventCode.trim().toUpperCase()] ?? null;
}

export const UNKNOWN_MEANING = "USCIS recorded an update we don't have a description for yet.";

export type Described = {
  title: string;
  meaning: string;
  tone: LifecycleTone;
  significance: Significance;
  stage?: Stage;
  tag?: LifecycleTag;
  entry: LifecycleEntry | null;
};

function fromEntry(entry: LifecycleEntry): Described {
  return { title: entry.title, meaning: entry.detail, tone: entry.tone, significance: entry.significance, stage: entry.stage, tag: entry.tag, entry };
}

/** Title and meaning for an event code. Unknown codes show the raw code. */
export function describeEvent(eventCode: string | null | undefined): Described {
  const entry = lookupEvent(eventCode);
  if (entry) return fromEntry(entry);
  return { title: eventCode?.trim() || "USCIS event", meaning: UNKNOWN_MEANING, tone: "neutral", significance: "step", entry: null };
}

/** Title and meaning for a notice actionType. Unknown notices show the raw string. */
export function describeNotice(actionType: string | null | undefined): Described {
  const entry = lookupNotice(actionType);
  if (entry) return fromEntry(entry);
  return { title: actionType?.trim() || "USCIS notice", meaning: UNKNOWN_MEANING, tone: "info", significance: "step", entry: null };
}
