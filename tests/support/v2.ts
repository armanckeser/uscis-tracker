// Builders for the v2 summary shapes the UI reads, made through the real shared
// pipeline (normalizeTimeline, deriveStage, predictForPerson) so a test fixture
// cannot drift from what the server sends.

import type { CaseSummary, PersonSummary, SummaryResponse } from "../../shared/api.js";
import { deriveStage } from "../../shared/stage.js";
import { normalizeTimeline, type ChangeRecord, type FactRecord } from "../../shared/timeline.js";
import { predictForPerson } from "../../shared/predict.js";
import type { CaseExpectation } from "../../shared/expectation.js";

let counter = 0;

export function change(over: Partial<ChangeRecord> & Pick<ChangeRecord, "changeType">): ChangeRecord {
  counter += 1;
  return {
    id: `chg-${counter}`,
    caseId: "case-1",
    snapshotId: `snap-${counter}`,
    fieldPath: null,
    label: "",
    occurredAt: "2026-06-05T15:00:00.000Z",
    payload: {},
    source: over.changeType === "baseline" || over.changeType === "silent_update" ? "tracker" : "uscis",
    firstSeenAt: "2026-06-06T00:00:00.000Z",
    acknowledgedAt: "2026-06-06T01:00:00.000Z",
    ...over,
  };
}

export const event = (code: string, occurredAt: string, over: Partial<ChangeRecord> = {}) =>
  change({ changeType: "event", fieldPath: `events[${code}]`, occurredAt, payload: { eventCode: code, eventId: `${code}${occurredAt}` }, ...over });

export const silent = (occurredAt: string, over: Partial<ChangeRecord> = {}) =>
  change({ changeType: "silent_update", fieldPath: "updatedAtTimestamp", occurredAt, payload: { alsoChanged: ["updatedAt"] }, ...over });

export const noticeChange = (actionType: string, occurredAt: string, payload: Record<string, unknown> = {}, over: Partial<ChangeRecord> = {}) =>
  change({ changeType: "notice", fieldPath: `notices[${actionType}]`, occurredAt, payload: { actionType, letterId: `L${occurredAt}`, ...payload }, ...over });

const noExpectation: CaseExpectation = {
  kind: "none",
  window: null,
  pastWindow: false,
  reason: null,
  summary: "",
  filedOn: "2026-04-29",
  timeSinceFiledDays: 153,
  timeSinceLastMovementDays: 55,
};

export function caseSummary(
  changes: ChangeRecord[],
  over: Partial<CaseSummary> & { facts?: FactRecord[] } = {},
): CaseSummary {
  const { facts = [], ...rest } = over;
  const id = rest.id ?? changes[0]?.caseId ?? "case-1";
  const timeline = normalizeTimeline(changes, facts);
  const formType = rest.formType ?? "I-485";
  const stage = deriveStage({ formType, closed: false }, timeline, facts, { today: "2026-09-29" });
  return {
    id,
    receiptNumber: "IOE1234567801",
    personId: "p1",
    personName: "Alex",
    formType,
    caseStatus: null,
    closed: false,
    latestSnapshotId: "snap-latest",
    lastCheckedAt: "2026-09-27T12:00:00.000Z",
    lastChangedAt: "2026-08-05T12:00:00.000Z",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    stage,
    expectation: noExpectation,
    timeline,
    ...rest,
  };
}

export function personSummary(over: Partial<PersonSummary> = {}): PersonSummary {
  const profile = { category: null, chargeability: null, priorityDate: null };
  return {
    id: "p1",
    name: "Alex",
    caseCount: 1,
    activeCaseCount: 1,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    profile: {
      ...profile,
      principalPersonId: null,
      effective: profile,
      inherited: { category: false, chargeability: false, priorityDate: false },
      complete: false,
    },
    prediction: predictForPerson(profile, { rows: [], uscisChart: {} }, "2026-09-29"),
    ...over,
  };
}

export function summaryOf(people: PersonSummary[], cases: CaseSummary[]): SummaryResponse {
  return {
    people,
    cases,
    noticeDetails: [],
    facts: [],
    bulletinData: { latestBulletin: null, processingTimesLoaded: false },
    config: { pushEnabled: true, vapidPublicKey: null },
  };
}
