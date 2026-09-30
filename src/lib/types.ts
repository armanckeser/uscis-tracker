// The UI reads the v2 API contract from shared/api.ts. These aliases keep the
// component code speaking in the tracker's own words.

import type { CaseSummary, PersonSummary, SummaryResponse } from "../../shared/api";
import type { FactRecord } from "../../shared/timeline";

export type Summary = SummaryResponse;
export type CaseRecord = CaseSummary;
export type PersonRecord = PersonSummary;
export type NoticeDetail = SummaryResponse["noticeDetails"][number];

/**
 * A fact only a human can assert. USCIS says an appointment was scheduled and
 * never says it happened, so this is the only way that question gets answered.
 */
export type CaseFact = FactRecord;

/**
 * Re-reads the summary from the server and hands back what it read.
 *
 * Most callers only care that the screen catches up, but a caller that has to
 * report on the result in the same breath needs the data, not the side effect.
 */
export type RefreshSummary = (silent?: boolean) => Promise<Summary | null>;

export type SnapshotResponse = {
  snapshot: {
    id: string;
    case_id: string;
    receipt_number: string;
    form_type: string | null;
    checked_at: string;
    source: "manual";
    raw_hash: string;
    raw_data: unknown;
  };
};

export type {
  BulletinHistory,
  CaseExpectation,
  CaseSummary,
  PersonPrediction,
  PersonSummary,
  PatchPersonBody,
  PersonProfile,
  Stage,
  StageInfo,
  TimelineEntry,
  TimelinePage,
} from "../../shared/api";
