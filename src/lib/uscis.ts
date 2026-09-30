// USCIS receipt/URL constants and small pure helpers shared across features.

import type { CaseRecord } from "./types";

export const RECEIPT_PATTERN = /^[A-Z]{3}[0-9]{10}$/;
export const USCIS_CASE_API_BASE_URL = "https://my.uscis.gov/account/case-service/api/cases/";
export const USCIS_ACCOUNT_URL = "https://my.uscis.gov/account/applicant";

export function uscisCaseApiUrl(receiptNumber: string): string {
  return `${USCIS_CASE_API_BASE_URL}${encodeURIComponent(receiptNumber)}`;
}

/** The newest snapshot on file for a case, or null if the case is unknown here. */
export function latestSnapshotIdFor(cases: CaseRecord[], caseId: string): string | null {
  return cases.find((caseRecord) => caseRecord.id === caseId)?.latestSnapshotId ?? null;
}

/** Most recent `lastCheckedAt` across all cases, or null if none have been checked. */
export function latestCheckedAt(cases: CaseRecord[]): string | null {
  const timestamps = cases
    .map((caseRecord) => caseRecord.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime());
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}
