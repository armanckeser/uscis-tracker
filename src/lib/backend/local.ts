// The browser-only backend: the same operations server/index.ts performs
// against Postgres, performed against this browser's IndexedDB. Nothing here
// talks to a tracker server, because there is none. Diffing, timelines, stages
// and predictions all come from shared/, so both backends agree by construction.

import { assembleSummary, bulletinHistory, type CaseInput, type PersonInput } from "../../../shared/assemble";
import { buildChanges, hashCaseData, isValidReceipt, normalizeReceipt, normalizeUscisResponse } from "../../../shared/domain";
import { categoryCandidates, type BulletinData } from "../../../shared/predict";
import { resolveProfile, type PersonProfileInput } from "../../../shared/profile";
import type { FactRecord } from "../../../shared/timeline";
import { createBulletinSource, type BulletinSource } from "./bulletins";
import {
  DATA_STORES,
  openDatabase,
  transact,
  type CaseRow,
  type ChangeRow,
  type NoticeDetailRow,
  type PersonRow,
  type SnapshotRow,
} from "./idb";
import type { Backend } from "./types";

export const BACKUP_FORMAT = "uscis-tracker-backup";

/** Everything the user entered or imported, as one file. Snapshots included: history is lossless. */
export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  people: PersonRow[];
  cases: CaseRow[];
  snapshots: SnapshotRow[];
  changes: ChangeRow[];
  facts: FactRecord[];
  noticeDetails: NoticeDetailRow[];
};

export type LocalBackend = Backend & {
  exportData(): Promise<Backup>;
  /** Replaces everything in this browser with the backup's contents. */
  restoreData(backup: unknown): Promise<{ people: number; cases: number }>;
  eraseData(): Promise<void>;
};

type Options = {
  open?: () => Promise<IDBDatabase>;
  bulletins?: BulletinSource;
  now?: () => Date;
  newId?: () => string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What Postgres does to a timestamptz on the way out. A value USCIS mangled falls back to when we saw it. */
function toIso(value: string, fallback: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

function profileText(value: string | null | undefined, label: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  if (trimmed.length > 16) throw new Error(`${label} is too long.`);
  return trimmed === "" ? null : trimmed.toUpperCase();
}

export function createLocalBackend(options: Options = {}): LocalBackend {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  let opened: Promise<IDBDatabase> | null = null;
  const database = () => (opened ??= (options.open ?? openDatabase)());

  let source: BulletinSource | null = options.bulletins ?? null;
  const bulletins = async () => (source ??= createBulletinSource(await database()));

  /** Bulletin rows for the tracked people's categories only, as the server's query selects them. */
  function rowsFor(data: BulletinData, people: PersonProfileInput[]): BulletinData {
    const byId = new Map(people.map((person) => [person.id, person]));
    const wanted = new Set(
      people
        .map((person) => resolveProfile(person, byId).effective.category)
        .filter((category): category is string => Boolean(category))
        .flatMap((category) => categoryCandidates(category)),
    );
    return { rows: data.rows.filter((row) => wanted.has(row.category)), uscisChart: data.uscisChart };
  }

  const backend: LocalBackend = {
    async getSummary() {
      const db = await database();
      const stored = await transact(db, ["people", "cases", "changes", "facts", "noticeDetails"], "readonly", async (t) => ({
        people: await t.people.all(),
        cases: await t.cases.all(),
        changes: await t.changes.all(),
        facts: await t.facts.all(),
        noticeDetails: await t.noticeDetails.all(),
      }));
      const dataset = await (await bulletins()).load();

      const names = new Map(stored.people.map((person) => [person.id, person.name]));
      const people: PersonInput[] = stored.people
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
        .map((person) => {
          const own = stored.cases.filter((row) => row.personId === person.id);
          return { ...person, caseCount: own.length, activeCaseCount: own.filter((row) => row.closed !== true).length };
        });
      const cases: CaseInput[] = stored.cases
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((row) => ({ ...row, personName: names.get(row.personId) ?? "" }));

      return assembleSummary({
        people,
        cases,
        changes: stored.changes.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.firstSeenAt.localeCompare(a.firstSeenAt)),
        facts: stored.facts.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
        noticeDetails: stored.noticeDetails,
        bulletins: rowsFor(dataset.bulletins, people),
        processingTimes: dataset.processingTimes,
        // Push needs a server to send it. There is none.
        config: { pushEnabled: false, vapidPublicKey: null },
        today: now().toISOString().slice(0, 10),
      });
    },

    async addPerson({ name }) {
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 80) throw new Error("A name needs 1 to 80 characters.");
      const at = now().toISOString();
      return transact(await database(), ["people"], "readwrite", async ({ people }) => {
        const existing = (await people.all()).find((person) => person.name === trimmed);
        if (existing) return { person: existing };
        const person: PersonRow = {
          id: newId(),
          name: trimmed,
          category: null,
          chargeability: null,
          priorityDate: null,
          principalPersonId: null,
          createdAt: at,
          updatedAt: at,
        };
        await people.put(person);
        return { person };
      });
    },

    async addCase(input) {
      const receiptNumber = normalizeReceipt(input.receiptNumber);
      if (!isValidReceipt(receiptNumber)) throw new Error("Receipt number must be 3 letters followed by 10 numbers.");
      const at = now().toISOString();
      return transact(await database(), ["people", "cases"], "readwrite", async ({ people, cases }) => {
        if (!(await people.get(input.personId))) throw new Error("Person not found.");
        const existing = await cases.oneByIndex("receiptNumber", receiptNumber);
        const row: CaseRow = existing
          ? { ...existing, personId: input.personId, updatedAt: at }
          : {
              id: newId(),
              receiptNumber,
              personId: input.personId,
              formType: null,
              caseStatus: null,
              closed: null,
              latestSnapshotId: null,
              lastCheckedAt: null,
              lastChangedAt: null,
              createdAt: at,
              updatedAt: at,
            };
        await cases.put(row);
        return { case: row };
      });
    },

    async deleteCase(id) {
      return transact(await database(), DATA_STORES, "readwrite", async (t) => {
        for (const row of await t.snapshots.byIndex("caseId", id)) await t.snapshots.delete(row.id);
        for (const row of await t.changes.byIndex("caseId", id)) await t.changes.delete(row.id);
        for (const row of await t.facts.byIndex("caseId", id)) await t.facts.delete(row.id);
        for (const row of await t.noticeDetails.all()) if (row.caseId === id) await t.noticeDetails.delete(row.letterId);
        await t.cases.delete(id);
        return { ok: true };
      });
    },

    async importSnapshot(input) {
      const data = normalizeUscisResponse(input.raw);
      // Hashed before the transaction opens: awaiting anything but the database
      // inside one lets it commit half-way.
      const rawHash = await hashCaseData(data);
      const checkedAt = now().toISOString();

      return transact(await database(), ["people", "cases", "snapshots", "changes"], "readwrite", async (t) => {
        const known = await t.cases.oneByIndex("receiptNumber", data.receiptNumber);
        // A tracked case already records its owner, so an import never moves it.
        // `personId` only matters for a receipt the tracker has never seen.
        const personId = known?.personId ?? input.personId;
        if (!personId) throw new Error(`${data.receiptNumber} is not tracked yet. Add the case, or choose who it belongs to.`);
        if (!known && !(await t.people.get(personId))) throw new Error("Person not found.");

        const caseRow: CaseRow = {
          ...(known ?? {
            id: newId(),
            receiptNumber: data.receiptNumber,
            personId,
            formType: null,
            caseStatus: null,
            closed: null,
            latestSnapshotId: null,
            lastCheckedAt: null,
            lastChangedAt: null,
            createdAt: checkedAt,
          }),
          updatedAt: checkedAt,
          lastCheckedAt: checkedAt,
        };
        caseRow.formType = data.formType ?? caseRow.formType;
        caseRow.caseStatus = data.caseStatus ?? caseRow.caseStatus;
        caseRow.closed = data.closed ?? caseRow.closed;

        if (await t.snapshots.oneByIndex("caseHash", [caseRow.id, rawHash])) {
          await t.cases.put(caseRow);
          return { outcome: "unchanged" as const, changes: [] };
        }

        const previous = caseRow.latestSnapshotId ? ((await t.snapshots.get(caseRow.latestSnapshotId))?.rawData ?? null) : null;
        const snapshotId = newId();
        await t.snapshots.put({ id: snapshotId, caseId: caseRow.id, checkedAt, rawHash, rawData: data });

        const drafts = buildChanges(previous, data, checkedAt);
        // The first snapshot of a case is history being imported, not news, so it
        // starts acknowledged. Otherwise adding a case would open with twenty
        // unread rows describing things the user already knows.
        const acknowledgedAt = previous ? null : checkedAt;
        const rows: ChangeRow[] = drafts.map((draft) => ({
          id: newId(),
          caseId: caseRow.id,
          snapshotId,
          changeType: draft.changeType,
          source: draft.source,
          fieldPath: draft.fieldPath,
          label: draft.label,
          severity: draft.severity,
          occurredAt: toIso(draft.occurredAt, checkedAt),
          payload: draft.payload,
          firstSeenAt: checkedAt,
          acknowledgedAt,
        }));
        for (const row of rows) await t.changes.put(row);

        // The newest time USCIS itself did something, not when we looked.
        const uscisTimes = (await t.changes.byIndex("caseId", caseRow.id)).filter((row) => row.source === "uscis").map((row) => row.occurredAt);
        caseRow.lastChangedAt = uscisTimes.sort().at(-1) ?? caseRow.lastChangedAt;
        caseRow.latestSnapshotId = snapshotId;
        await t.cases.put(caseRow);

        return { outcome: "stored" as const, changes: drafts };
      });
    },

    async recordCaseFact(caseId, input) {
      if (!DATE.test(input.occurredOn)) throw new Error("Use a YYYY-MM-DD date.");
      const note = input.note?.trim() || null;
      if (note && note.length > 500) throw new Error("That note is too long.");
      const letterId = input.letterId ?? null;
      const at = now().toISOString();

      return transact(await database(), ["cases", "facts"], "readwrite", async ({ cases, facts }) => {
        if (!(await cases.get(caseId))) throw new Error("Case not found.");
        const sameAppointment = (await facts.byIndex("caseId", caseId)).filter((fact) => fact.letterId === letterId);
        // Re-answering replaces the answer, and answering one way retires the
        // opposite, so a corrected outcome does not leave both on the timeline.
        for (const fact of sameAppointment) if (fact.kind !== input.kind) await facts.delete(fact.id);
        const existing = sameAppointment.find((fact) => fact.kind === input.kind);
        const fact: FactRecord = existing
          ? { ...existing, occurredOn: input.occurredOn, note }
          : { id: newId(), caseId, kind: input.kind, occurredOn: input.occurredOn, letterId, note, createdAt: at };
        await facts.put(fact);
        return { fact };
      });
    },

    async deleteCaseFact(id) {
      return transact(await database(), ["facts"], "readwrite", async ({ facts }) => {
        await facts.delete(id);
        return { ok: true };
      });
    },

    async acknowledgeChanges() {
      const at = now().toISOString();
      return transact(await database(), ["changes"], "readwrite", async ({ changes }) => {
        const unread = (await changes.all()).filter((row) => row.acknowledgedAt === null);
        for (const row of unread) await changes.put({ ...row, acknowledgedAt: at });
        return { acknowledged: unread.length };
      });
    },

    async getSnapshot(id) {
      return transact(await database(), ["snapshots", "cases"], "readonly", async ({ snapshots, cases }) => {
        const row = await snapshots.get(id);
        if (!row) throw new Error("Snapshot not found.");
        const owner = await cases.get(row.caseId);
        return {
          snapshot: {
            id: row.id,
            case_id: row.caseId,
            receipt_number: owner?.receiptNumber ?? row.rawData.receiptNumber,
            form_type: owner?.formType ?? null,
            checked_at: row.checkedAt,
            source: "manual" as const,
            raw_hash: row.rawHash,
            raw_data: row.rawData,
          },
        };
      });
    },

    async putNoticeDetails(letterId, details) {
      const valid = Object.values(details).every((value) => typeof value === "string" && value.length <= 500);
      if (!valid) throw new Error("Each detail needs to be 500 characters or fewer.");
      const at = now().toISOString();
      return transact(await database(), ["noticeDetails", "changes"], "readwrite", async ({ noticeDetails, changes }) => {
        const existing = await noticeDetails.get(letterId);
        const notice = (await changes.all())
          .filter((row) => row.changeType === "notice" && (row.payload as { letterId?: unknown } | null)?.letterId === letterId)
          .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))[0];
        const noticeDetail: NoticeDetailRow = { letterId, caseId: existing?.caseId ?? notice?.caseId ?? null, details, updatedAt: at };
        await noticeDetails.put(noticeDetail);
        return { noticeDetail };
      });
    },

    async patchPerson(id, body) {
      const category = profileText(body.category, "Category");
      const chargeability = profileText(body.chargeability, "Country");
      if (body.priority_date != null && !DATE.test(body.priority_date)) throw new Error("Use a YYYY-MM-DD date.");
      if (body.principal_person_id === id) throw new Error("A person cannot be their own principal.");
      const at = now().toISOString();

      return transact(await database(), ["people"], "readwrite", async ({ people }) => {
        const all = await people.all();
        const person = all.find((candidate) => candidate.id === id);
        if (!person) throw new Error("Person not found.");
        if (body.principal_person_id) {
          // Refuse a cycle: walk up from the proposed principal and make sure we never reach this person.
          const parent = new Map(all.map((candidate) => [candidate.id, candidate.principalPersonId]));
          if (!parent.has(body.principal_person_id)) throw new Error("Principal not found.");
          let cursor: string | null | undefined = body.principal_person_id;
          for (let hops = 0; cursor && hops < 20; hops += 1) {
            if (cursor === id) throw new Error("That would make a loop of principals.");
            cursor = parent.get(cursor);
          }
        }
        // Only the keys sent change; null clears.
        const next: PersonRow = { ...person, updatedAt: at };
        if (category !== undefined) next.category = category;
        if (chargeability !== undefined) next.chargeability = chargeability;
        if (body.priority_date !== undefined) next.priorityDate = body.priority_date;
        if (body.principal_person_id !== undefined) next.principalPersonId = body.principal_person_id;
        await people.put(next);
        return { person: next };
      });
    },

    async getBulletinHistory(category, country) {
      const dataset = await (await bulletins()).load();
      return bulletinHistory(dataset.bulletins.rows, category, country.trim() || "ROW");
    },

    async subscribePush() {
      throw new Error("Notifications need the self-hosted tracker. This one has no server to send them.");
    },

    async unsubscribePush() {
      return { ok: true };
    },

    async exportData() {
      const stored = await transact(await database(), DATA_STORES, "readonly", async (t) => ({
        people: await t.people.all(),
        cases: await t.cases.all(),
        snapshots: await t.snapshots.all(),
        changes: await t.changes.all(),
        facts: await t.facts.all(),
        noticeDetails: await t.noticeDetails.all(),
      }));
      return { format: BACKUP_FORMAT, version: 1, exportedAt: now().toISOString(), ...stored };
    },

    async restoreData(input) {
      const backup = input as Partial<Backup> | null;
      const lists = DATA_STORES.map((name) => backup?.[name]);
      if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== 1 || !lists.every(Array.isArray)) {
        throw new Error("That file is not a USCIS Tracker backup.");
      }
      const data = backup as Backup;
      return transact(await database(), DATA_STORES, "readwrite", async (t) => {
        for (const name of DATA_STORES) await t[name].clear();
        for (const row of data.people) await t.people.put(row);
        for (const row of data.cases) await t.cases.put(row);
        for (const row of data.snapshots) await t.snapshots.put(row);
        for (const row of data.changes) await t.changes.put(row);
        for (const row of data.facts) await t.facts.put(row);
        for (const row of data.noticeDetails) await t.noticeDetails.put(row);
        return { people: data.people.length, cases: data.cases.length };
      });
    },

    async eraseData() {
      await transact(await database(), DATA_STORES, "readwrite", async (t) => {
        for (const name of DATA_STORES) await t[name].clear();
      });
    },
  };

  return backend;
}

let shared: LocalBackend | null = null;

/** This browser's tracker. The database opens on first use, not on import. */
export function localBackend(): LocalBackend {
  return (shared ??= createLocalBackend());
}
