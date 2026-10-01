import type { BulletinHistory, NoticeDetail, PatchPersonBody, SnapshotResponse, Summary } from "../types";

/**
 * What became of an imported response. `unchanged` means USCIS returned a
 * response the tracker already holds — a real and common outcome the UI has to
 * state, rather than reporting a blanket success either way.
 */
export type ImportResult = {
  outcome: "stored" | "unchanged";
  changes: { changeType: string }[];
};

export type CaseFactInput = {
  kind: "appointment_attended" | "appointment_missed";
  occurredOn: string;
  letterId?: string;
  note?: string;
};

/**
 * Everything the UI asks of a tracker. Two things answer to it: the self-hosted
 * API (http.ts) and this browser's own IndexedDB (local.ts).
 */
export type Backend = {
  getSummary(): Promise<Summary>;
  addPerson(input: { name: string }): Promise<unknown>;
  addCase(input: { receiptNumber: string; personId: string }): Promise<unknown>;
  deleteCase(id: string): Promise<unknown>;
  importSnapshot(input: { raw: unknown; personId?: string }): Promise<ImportResult>;
  recordCaseFact(caseId: string, input: CaseFactInput): Promise<unknown>;
  deleteCaseFact(id: string): Promise<unknown>;
  acknowledgeChanges(): Promise<{ acknowledged: number }>;
  getSnapshot(id: string): Promise<SnapshotResponse>;
  putNoticeDetails(letterId: string, details: Record<string, string>): Promise<{ noticeDetail: NoticeDetail }>;
  subscribePush(subscription: PushSubscription): Promise<unknown>;
  unsubscribePush(endpoint: string): Promise<unknown>;
  patchPerson(id: string, body: PatchPersonBody): Promise<unknown>;
  getBulletinHistory(category: string, country: string): Promise<BulletinHistory>;
};
