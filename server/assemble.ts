// Builds the /api/summary payload from stored rows. Pure so the shape the UI
// depends on is testable without a database.

import type { BulletinHistory, BulletinPoint, CaseSummary, PersonSummary, RawChange, SummaryResponse, TimelinePage } from "../shared/api.js";
import { predictForCase, type ProcessingTimeRow } from "../shared/expectation.js";
import { predictForPerson, selectSeries, type BulletinData, type CutoffPoint } from "../shared/predict.js";
import { resolveProfile, type PersonProfileInput } from "../shared/profile.js";
import { deriveStage } from "../shared/stage.js";
import { normalizeTimeline, type ChangeRecord, type FactRecord, type TimelineEntry } from "../shared/timeline.js";

export type PersonInput = PersonProfileInput & {
  name: string;
  caseCount: number;
  activeCaseCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CaseInput = {
  id: string;
  receiptNumber: string;
  personId: string;
  personName: string;
  formType: string | null;
  caseStatus: string | null;
  closed: boolean | null;
  latestSnapshotId: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssembleInput = {
  people: PersonInput[];
  cases: CaseInput[];
  changes: (ChangeRecord & Partial<Pick<RawChange, "receiptNumber" | "formType" | "personId" | "personName" | "severity">>)[];
  facts: FactRecord[];
  noticeDetails: SummaryResponse["noticeDetails"];
  bulletins: BulletinData;
  processingTimes: ProcessingTimeRow[];
  config: SummaryResponse["config"];
  today: string;
  raw?: boolean;
};

export function assembleSummary(input: AssembleInput): SummaryResponse {
  const profileInputs = new Map(input.people.map((p) => [p.id, p as PersonProfileInput]));

  const people: PersonSummary[] = input.people.map((person) => {
    const resolved = resolveProfile(person, profileInputs);
    return {
      id: person.id,
      name: person.name,
      caseCount: person.caseCount,
      activeCaseCount: person.activeCaseCount,
      createdAt: person.createdAt,
      updatedAt: person.updatedAt,
      profile: {
        category: resolved.own.category,
        chargeability: resolved.own.chargeability,
        priorityDate: resolved.own.priorityDate,
        principalPersonId: resolved.principalPersonId,
        effective: resolved.effective,
        inherited: resolved.inherited,
        complete: resolved.complete,
      },
      prediction: predictForPerson(resolved.effective, input.bulletins, input.today),
    };
  });
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const changesByCase = new Map<string, ChangeRecord[]>();
  for (const change of input.changes) {
    const list = changesByCase.get(change.caseId) ?? [];
    list.push(change);
    changesByCase.set(change.caseId, list);
  }
  const factsByCase = new Map<string, FactRecord[]>();
  for (const fact of input.facts) {
    const list = factsByCase.get(fact.caseId) ?? [];
    list.push(fact);
    factsByCase.set(fact.caseId, list);
  }

  const cases: CaseSummary[] = input.cases.map((row) => {
    const changes = changesByCase.get(row.id) ?? [];
    const facts = factsByCase.get(row.id) ?? [];
    const timeline = normalizeTimeline(changes, facts);
    const person = peopleById.get(row.personId);
    const submissionAt = changes.filter((c) => c.changeType === "submission" && c.source === "uscis").map((c) => c.occurredAt).sort()[0] ?? null;
    const expectation = predictForCase(
      { formType: row.formType, receiptNumber: row.receiptNumber, submissionAt, lastUscisMovementAt: row.lastChangedAt, closed: row.closed },
      person?.profile.effective ?? null,
      input.processingTimes,
      person?.prediction ?? null,
      input.today,
    );
    const stage = deriveStage(row, timeline, facts, {
      prediction: person?.prediction ?? null,
      expectation,
      siblings: input.cases.filter((c) => c.personId === row.personId && c.id !== row.id),
      today: input.today,
    });
    return { ...row, stage, expectation, timeline };
  });

  const response: SummaryResponse = {
    people,
    cases,
    noticeDetails: input.noticeDetails,
    facts: input.facts,
    bulletinData: {
      latestBulletin: input.bulletins.rows.map((r) => r.bulletin).sort().at(-1) ?? null,
      processingTimesLoaded: input.processingTimes.length > 0,
    },
    config: input.config,
  };
  if (input.raw) {
    response.changes = input.changes.map((c) => ({
      ...c,
      receiptNumber: c.receiptNumber ?? "",
      formType: c.formType ?? null,
      personId: c.personId ?? "",
      personName: c.personName ?? "",
      severity: c.severity ?? "info",
    }));
  }
  return response;
}

/** Newest-first page of a case's timeline. `before` is an occurredAt cursor (exclusive). */
export function pageTimeline(caseId: string, timeline: TimelineEntry[], limit: number, before?: string): TimelinePage {
  const eligible = before ? timeline.filter((e) => e.occurredAt < before) : timeline;
  const entries = eligible.slice(0, limit);
  const more = eligible.length > entries.length;
  return { caseId, entries, total: timeline.length, nextBefore: more ? entries.at(-1)?.occurredAt ?? null : null };
}

const point = (p: CutoffPoint | undefined): BulletinPoint | null => (p ? { status: p.status, date: p.date } : null);

/** The monthly FAD and DFF series for one category and country, for charting. */
export function bulletinHistory(rows: BulletinData["rows"], category: string, country: string): BulletinHistory {
  const fad = new Map(selectSeries(rows, "final_action", category, country).map((p) => [p.bulletin, p]));
  const dff = new Map(selectSeries(rows, "dates_for_filing", category, country).map((p) => [p.bulletin, p]));
  const months = [...new Set([...fad.keys(), ...dff.keys()])].sort();
  return {
    category: category.toUpperCase(),
    country: country.toUpperCase(),
    months: months.map((bulletin) => ({ bulletin, finalAction: point(fad.get(bulletin)), datesForFiling: point(dff.get(bulletin)) })),
  };
}
