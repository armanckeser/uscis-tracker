// Where a case is in its life and what happens next. Derived from the timeline
// through the shared lifecycle registry, never stored: change the registry and
// every case re-reads correctly.

import { daysBetween, toIsoDate } from "./dates.js";
import type { CaseExpectation } from "./expectation.js";
import { STAGES, type Stage } from "./lifecycle.js";
import { formatDay, type PersonPrediction } from "./predict.js";
import type { FactRecord, TimelineEntry } from "./timeline.js";

export type WaitingOn = "uscis" | "you" | "visa_availability";

export type StageInfo = {
  stage: Stage;
  /** When the case reached this stage (ISO instant), or null when nothing dates it. */
  since: string | null;
  outcome: "approved" | "denied" | null;
  nextStep: { label: string; expectedWindow?: { from: string; to: string } } | null;
  waitingOn: WaitingOn;
  /** Extra context, e.g. that an I-765 is tied to an open I-485. */
  note: string | null;
};

export type StageCase = {
  formType: string | null;
  closed: boolean | null;
};

export type StageContext = {
  prediction?: PersonPrediction | null;
  expectation?: CaseExpectation | null;
  /** The person's other cases. */
  siblings?: StageCase[];
  today?: Date | string;
};

const rank = (stage: Stage) => STAGES.indexOf(stage);

function isForm(form: string | null, wanted: string): boolean {
  return (form ?? "").replace(/[\s-]/g, "").toUpperCase() === wanted;
}

function hasOutcome(fact: FactRecord | undefined) {
  return Boolean(fact);
}

export function deriveStage(caseInfo: StageCase, timeline: TimelineEntry[], facts: FactRecord[] = [], ctx: StageContext = {}): StageInfo {
  const today = toIsoDate(ctx.today ?? new Date());
  const uscis = timeline.filter((e) => e.source === "uscis");
  const byTime = [...uscis].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  // A case only moves forward: the furthest stage any USCIS entry has reached.
  let stage: Stage = "filed";
  for (const entry of byTime) if (entry.stage && rank(entry.stage) > rank(stage)) stage = entry.stage;

  const last = (tags: string[]) => [...byTime].reverse().find((e) => e.tag && tags.includes(e.tag));
  const lastApproved = last(["approved"]);
  const lastDenied = last(["denied"]);
  let outcome: StageInfo["outcome"] = null;
  if (lastDenied && (!lastApproved || lastDenied.occurredAt > lastApproved.occurredAt)) outcome = "denied";
  else if (lastApproved || rank(stage) >= rank("card")) outcome = "approved";

  let since: string | null;
  if (caseInfo.closed) {
    stage = "closed";
    since = [...byTime].reverse().find((e) => e.kind === "closed")?.occurredAt ?? byTime.at(-1)?.occurredAt ?? null;
  } else {
    since = byTime.find((e) => e.stage === stage)?.occurredAt ?? byTime.find((e) => e.kind === "submission")?.occurredAt ?? byTime[0]?.occurredAt ?? null;
  }

  // What only the person can do.
  const openRequest = last(["rfe", "noid"]);
  const answered = openRequest ? last(["rfe_response"]) : undefined;
  const requestOpen = Boolean(openRequest && (!answered || answered.occurredAt < openRequest.occurredAt));

  const outcomeFor = (entry: TimelineEntry) => facts.find((f) => f.letterId && f.letterId === entry.letterId);
  const appointments = uscis.filter((e) => e.appointmentAt && (e.tag === "biometrics" || e.tag === "interview"));
  const upcoming = appointments
    .filter((e) => e.appointmentAt!.slice(0, 10) >= today && !hasOutcome(outcomeFor(e)))
    .sort((a, b) => a.appointmentAt!.localeCompare(b.appointmentAt!))[0];
  const unanswered = appointments
    .filter((e) => e.appointmentAt!.slice(0, 10) < today && !hasOutcome(outcomeFor(e)))
    .sort((a, b) => b.appointmentAt!.localeCompare(a.appointmentAt!))[0];

  const window = ctx.expectation?.window ? { from: ctx.expectation.window.from, to: ctx.expectation.window.to } : undefined;
  let nextStep: StageInfo["nextStep"] = null;
  let waitingOn: WaitingOn = "uscis";
  let note: string | null = null;

  const p = ctx.prediction;
  const visaBlocked = isForm(caseInfo.formType, "I485") && p?.status === "ok" && p.isCurrent === false;

  if (caseInfo.closed) {
    nextStep = null;
  } else if (requestOpen && openRequest) {
    waitingOn = "you";
    const what = openRequest.tag === "noid" ? "notice of intent to deny" : "request for evidence";
    nextStep = { label: `Respond to your ${what}. The deadline is on the paper notice.` };
  } else if (upcoming) {
    waitingOn = "you";
    const kind = upcoming.tag === "interview" ? "interview" : "biometrics appointment";
    nextStep = { label: `Attend your ${kind} on ${formatDay(upcoming.appointmentAt!.slice(0, 10))}` };
  } else if (outcome === "denied") {
    waitingOn = "you";
    nextStep = { label: "Read the denial notice for the reason and any appeal or motion deadline" };
  } else {
    switch (stage) {
      case "filed":
        nextStep = { label: "Biometrics appointment, if required, or the first officer review", expectedWindow: window };
        break;
      case "biometrics":
        nextStep = { label: "USCIS finishes background checks and continues review", expectedWindow: window };
        break;
      case "review":
        nextStep = { label: "Officer review. USCIS may ask for evidence, schedule an interview, or decide", expectedWindow: window };
        break;
      case "interview":
        nextStep = { label: "USCIS decides after the interview", expectedWindow: window };
        break;
      case "decision":
        nextStep = { label: "Card production and mailing" };
        break;
      case "card": {
        const tag = last(["card_produced", "card_mailed", "card_picked_up", "card_delivered"])?.tag;
        nextStep =
          tag === "card_delivered" ? { label: "Check that the name, dates and category on the card are correct" }
          : tag === "card_produced" ? { label: "USCIS mails the card" }
          : { label: "USPS delivers the card" };
        break;
      }
    }
    if (visaBlocked && rank(stage) <= rank("interview")) waitingOn = "visa_availability";
  }

  if (unanswered && !caseInfo.closed) {
    const kind = unanswered.tag === "interview" ? "interview" : "biometrics appointment";
    const days = daysBetween(unanswered.appointmentAt!.slice(0, 10), today);
    note = `Your ${kind} was ${days} day${days === 1 ? "" : "s"} ago. Record whether you attended.`;
  }

  const tied = (isForm(caseInfo.formType, "I765") || isForm(caseInfo.formType, "I131")) && (ctx.siblings ?? []).some((s) => isForm(s.formType, "I485") && s.closed !== true);
  if (tied && !caseInfo.closed) note = ["Tied to your I-485, which is still open.", note].filter(Boolean).join(" ");

  return { stage, since, outcome, nextStep, waitingOn, note };
}
