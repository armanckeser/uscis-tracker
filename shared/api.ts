// The v2 API contract, as types. The server builds these; the UI imports them.
// Everything here is JSON-serialisable and camelCase.

import type { CaseExpectation } from "./expectation.js";
import type { PersonPrediction } from "./predict.js";
import type { ProfileFields, ProfileField } from "./profile.js";
import type { StageInfo } from "./stage.js";
import type { ChangeRecord, FactRecord, TimelineEntry } from "./timeline.js";

export type { CaseExpectation, PersonPrediction, StageInfo, TimelineEntry, ProfileFields };
export type { TimelineSubEntry, FactSource, TimelineKind } from "./timeline.js";
export type { Stage, Significance } from "./lifecycle.js";

/** `people[].profile`: what the person entered, what applies, and where it came from. */
export type PersonProfile = {
  category: string | null;
  chargeability: string | null;
  /** YYYY-MM-DD */
  priorityDate: string | null;
  principalPersonId: string | null;
  /** Own values falling back to the principal's. */
  effective: ProfileFields;
  /** Which effective fields came from the principal. */
  inherited: Record<ProfileField, boolean>;
  /** Enough is known to place the person against the visa bulletin (or they are an immediate relative). */
  complete: boolean;
};

export type PersonSummary = {
  id: string;
  name: string;
  caseCount: number;
  activeCaseCount: number;
  createdAt: string;
  updatedAt: string;
  profile: PersonProfile;
  prediction: PersonPrediction;
};

export type CaseSummary = {
  id: string;
  receiptNumber: string;
  personId: string;
  personName: string;
  formType: string | null;
  caseStatus: string | null;
  closed: boolean | null;
  latestSnapshotId: string | null;
  lastCheckedAt: string | null;
  /** The newest time USCIS itself did something to the case (max occurredAt of uscis-source changes). */
  lastChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stage: StageInfo;
  expectation: CaseExpectation;
  /** Normalized, newest first, complete. `GET /api/cases/:id/timeline` pages the same list. */
  timeline: TimelineEntry[];
};

/** A raw stored change, returned only with `GET /api/summary?raw=1`. */
export type RawChange = ChangeRecord & {
  receiptNumber: string;
  formType: string | null;
  personId: string;
  personName: string;
  severity: "info" | "success" | "warning" | "error";
};

export type SummaryResponse = {
  people: PersonSummary[];
  cases: CaseSummary[];
  noticeDetails: { letterId: string; caseId: string | null; details: Record<string, string>; updatedAt: string }[];
  facts: FactRecord[];
  bulletinData: {
    /** Newest bulletin month in the database, or null before the first sync. */
    latestBulletin: string | null;
    processingTimesLoaded: boolean;
  };
  config: { pushEnabled: boolean; vapidPublicKey: string | null };
  /** Present only with `?raw=1`. */
  changes?: RawChange[];
};

export type TimelinePage = {
  caseId: string;
  entries: TimelineEntry[];
  total: number;
  /** Pass as `before` to fetch the next (older) page; null on the last page. */
  nextBefore: string | null;
};

export type PatchPersonBody = {
  category?: string | null;
  chargeability?: string | null;
  /** YYYY-MM-DD */
  priority_date?: string | null;
  principal_person_id?: string | null;
};

export type BulletinPoint = { status: "date" | "current" | "unavailable"; date: string | null };

export type BulletinHistory = {
  category: string;
  country: string;
  months: { bulletin: string; finalAction: BulletinPoint | null; datesForFiling: BulletinPoint | null }[];
};
