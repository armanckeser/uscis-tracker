// The browser-only tracker's database. The stores mirror schema.sql's tables, in
// the camelCase shapes the API already speaks, so the same shared code assembles
// a summary from either.

import type { UscisCaseData } from "../../../shared/domain";
import type { ChangeRecord, FactRecord } from "../../../shared/timeline";
import type { RawChange } from "../../../shared/api";

export const DB_NAME = "uscis-tracker";
const DB_VERSION = 1;

export type PersonRow = {
  id: string;
  name: string;
  category: string | null;
  chargeability: string | null;
  priorityDate: string | null;
  principalPersonId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CaseRow = {
  id: string;
  receiptNumber: string;
  personId: string;
  formType: string | null;
  caseStatus: string | null;
  closed: boolean | null;
  latestSnapshotId: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SnapshotRow = { id: string; caseId: string; checkedAt: string; rawHash: string; rawData: UscisCaseData };

export type ChangeRow = ChangeRecord & Pick<RawChange, "severity">;

export type NoticeDetailRow = { letterId: string; caseId: string | null; details: Record<string, string>; updatedAt: string };

export type MetaRow = { key: string; value: unknown };

export type Stores = {
  people: PersonRow;
  cases: CaseRow;
  snapshots: SnapshotRow;
  changes: ChangeRow;
  facts: FactRecord;
  noticeDetails: NoticeDetailRow;
  meta: MetaRow;
};

export type StoreName = keyof Stores;

/** The stores that hold what the user entered or imported. `meta` is only a cache. */
export const DATA_STORES = ["people", "cases", "snapshots", "changes", "facts", "noticeDetails"] as const satisfies readonly StoreName[];

export function openDatabase(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("people", { keyPath: "id" });
      db.createObjectStore("cases", { keyPath: "id" }).createIndex("receiptNumber", "receiptNumber", { unique: true });
      const snapshots = db.createObjectStore("snapshots", { keyPath: "id" });
      // One row per distinct response per case, as UNIQUE (case_id, raw_hash) does.
      snapshots.createIndex("caseHash", ["caseId", "rawHash"], { unique: true });
      snapshots.createIndex("caseId", "caseId");
      db.createObjectStore("changes", { keyPath: "id" }).createIndex("caseId", "caseId");
      db.createObjectStore("facts", { keyPath: "id" }).createIndex("caseId", "caseId");
      db.createObjectStore("noticeDetails", { keyPath: "letterId" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open this browser's storage."));
    request.onblocked = () => reject(new Error("The tracker is open in another tab that needs to be closed first."));
  });
}

export function wait<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** A typed view of one object store inside a transaction. */
export type Table<Row> = {
  get(key: IDBValidKey): Promise<Row | undefined>;
  all(): Promise<Row[]>;
  byIndex(index: string, key: IDBValidKey): Promise<Row[]>;
  oneByIndex(index: string, key: IDBValidKey): Promise<Row | undefined>;
  put(row: Row): Promise<void>;
  delete(key: IDBValidKey): Promise<void>;
  clear(): Promise<void>;
};

function table<Row>(store: IDBObjectStore): Table<Row> {
  return {
    get: (key) => wait(store.get(key)) as Promise<Row | undefined>,
    all: () => wait(store.getAll()) as Promise<Row[]>,
    byIndex: (index, key) => wait(store.index(index).getAll(key)) as Promise<Row[]>,
    oneByIndex: (index, key) => wait(store.index(index).get(key)) as Promise<Row | undefined>,
    put: async (row) => void (await wait(store.put(row))),
    delete: async (key) => void (await wait(store.delete(key))),
    clear: async () => void (await wait(store.clear())),
  };
}

export type Tables<Names extends StoreName> = { [Name in Names]: Table<Stores[Name]> };

/**
 * Runs `work` inside one transaction and resolves once it has committed.
 *
 * `work` may only await the tables it is handed. An IndexedDB transaction
 * commits as soon as it has nothing queued, so awaiting anything else (a fetch,
 * a hash) ends it mid-way: do that before calling this.
 */
export function transact<Names extends StoreName, Result>(
  db: IDBDatabase,
  names: readonly Names[],
  mode: IDBTransactionMode,
  work: (tables: Tables<Names>) => Promise<Result>,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names as readonly string[] as string[], mode);
    const tables = Object.fromEntries(names.map((name) => [name, table(tx.objectStore(name))])) as Tables<Names>;
    let result: Result;
    let failure: unknown = null;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("The change could not be saved."));
    work(tables).then(
      (value) => {
        result = value;
      },
      (error) => {
        failure = error;
        try {
          tx.abort();
        } catch {
          // Already finished; onabort or onerror has rejected.
          reject(error);
        }
      },
    );
  });
}
