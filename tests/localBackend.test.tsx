import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createBulletinSource, type Dataset } from "../src/lib/backend/bulletins.js";
import { openDatabase } from "../src/lib/backend/idb.js";
import { BACKUP_FORMAT, createLocalBackend } from "../src/lib/backend/local.js";
import { unreadEntries } from "../src/lib/unread.js";

// The browser-only backend does what server/index.ts does, against IndexedDB.
// These pin the behaviours a household would notice if the two drifted.

const A485 = "IOE9912345601";
const A765 = "IOE9912345602";

const ev = (code: string, at: string) => ({ eventId: `${code}-${at}`, eventCode: code, createdAtTimestamp: at });

function response(receiptNumber: string, over: Record<string, unknown> = {}) {
  return {
    data: {
      receiptNumber,
      formType: "I-485",
      caseStatus: "Case Was Received",
      closed: false,
      submissionTimestamp: "2026-04-28T14:02:11.000Z",
      updatedAtTimestamp: "2026-06-11T16:20:00.000Z",
      events: [ev("IAF", "2026-04-28T14:02:11.000Z"), ev("FTA0", "2026-06-11T16:20:00.000Z")],
      notices: [{ letterId: "400000001", actionType: "Receipt Notice Was Sent", generationDate: "2026-05-01T09:00:00.000Z" }],
      ...over,
    },
  };
}

const noBulletins: Dataset = { bulletins: { rows: [], uscisChart: {} }, processingTimes: [] };

function tracker(bulletins: Dataset = noBulletins) {
  const factory = new IDBFactory();
  let clock = Date.parse("2026-09-30T12:00:00.000Z");
  let ids = 0;
  const backend = createLocalBackend({
    open: () => openDatabase(factory),
    bulletins: { load: async () => bulletins },
    // Each call is a minute later, so "first seen" orders the way real use does.
    now: () => new Date((clock += 60_000)),
    newId: () => `id-${(ids += 1)}`,
  });
  return { backend, factory };
}

async function household() {
  const { backend, factory } = tracker();
  const { person } = (await backend.addPerson({ name: "Alex" })) as { person: { id: string } };
  await backend.addCase({ receiptNumber: A485, personId: person.id });
  return { backend, factory, alex: person.id };
}

describe("local backend: importing", () => {
  it("stores_the_first_response_as_read_history_not_news", async () => {
    const { backend } = await household();

    const result = await backend.importSnapshot({ raw: response(A485) });
    const summary = await backend.getSummary();

    expect(result.outcome).toBe("stored");
    expect(summary.cases).toHaveLength(1);
    expect(summary.cases[0]).toMatchObject({ receiptNumber: A485, formType: "I-485", personName: "Alex", caseStatus: "Case Was Received" });
    expect(summary.cases[0].timeline.length).toBeGreaterThan(0);
    // Adding a case must not open with a screen of unread rows the person already knows.
    expect(unreadEntries(summary.cases)).toHaveLength(0);
    // The newest thing USCIS did, on USCIS's clock.
    expect(summary.cases[0].lastChangedAt).toBe("2026-06-11T16:20:00.000Z");
  });

  it("reports_an_identical_response_as_unchanged_and_stores_nothing", async () => {
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });
    const before = await backend.exportData();

    const result = await backend.importSnapshot({ raw: response(A485) });
    const after = await backend.exportData();

    expect(result).toEqual({ outcome: "unchanged", changes: [] });
    expect(after.snapshots).toHaveLength(1);
    expect(after.changes).toHaveLength(before.changes.length);
    // It still counts as a read: "checked" moves even when nothing else does.
    expect(after.cases[0].lastCheckedAt! > before.cases[0].lastCheckedAt!).toBe(true);
  });

  it("catches_a_silent_update_and_leaves_it_unread", async () => {
    // The reason the tracker exists: USCIS touches the case and names nothing.
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });

    const result = await backend.importSnapshot({ raw: response(A485, { updatedAtTimestamp: "2026-09-29T21:14:00.000Z" }) });
    const unread = unreadEntries((await backend.getSummary()).cases);

    expect(result.changes.map((change) => change.changeType)).toEqual(["silent_update"]);
    expect(unread).toHaveLength(1);
    expect(unread[0].entry.kind).toBe("silent_update");
  });

  it("marks_new_movement_unread_until_it_is_acknowledged", async () => {
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });
    const moved = response(A485);
    moved.data.events = [...moved.data.events, ev("IMAG", "2026-09-28T18:30:00.000Z")];
    moved.data.updatedAtTimestamp = "2026-09-28T18:30:00.000Z";

    await backend.importSnapshot({ raw: moved });
    expect(unreadEntries((await backend.getSummary()).cases)).toHaveLength(1);

    expect(await backend.acknowledgeChanges()).toEqual({ acknowledged: 1 });
    expect(unreadEntries((await backend.getSummary()).cases)).toHaveLength(0);
  });

  it("refuses_a_receipt_nobody_is_tracking_and_keeps_the_database_untouched", async () => {
    const { backend } = await household();

    await expect(backend.importSnapshot({ raw: response(A765) })).rejects.toThrow(`${A765} is not tracked yet`);
    const data = await backend.exportData();
    expect(data.cases).toHaveLength(1);
    expect(data.snapshots).toHaveLength(0);
  });

  it("never_moves_a_tracked_case_to_whoever_the_import_names", async () => {
    // Regression guarded on the server too: one wrong pick in the import dropdown
    // used to silently move a case to another person.
    const { backend, alex } = await household();
    const { person: sam } = (await backend.addPerson({ name: "Sam" })) as { person: { id: string } };

    await backend.importSnapshot({ raw: response(A485), personId: sam.id });

    expect((await backend.getSummary()).cases[0].personId).toBe(alex);
  });

  it("rolls_the_whole_import_back_when_it_fails_part_way", async () => {
    const { backend } = await household();

    await expect(backend.importSnapshot({ raw: response(A765), personId: "nobody" })).rejects.toThrow("Person not found.");
    expect((await backend.exportData()).cases.map((row) => row.receiptNumber)).toEqual([A485]);
  });

  it("serves_the_stored_response_back_for_the_evidence_viewer", async () => {
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });
    const { latestSnapshotId } = (await backend.getSummary()).cases[0];

    const { snapshot } = await backend.getSnapshot(latestSnapshotId!);

    expect(snapshot).toMatchObject({ receipt_number: A485, form_type: "I-485", source: "manual" });
    expect((snapshot.raw_data as { receiptNumber: string }).receiptNumber).toBe(A485);
    expect(snapshot.raw_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("local backend: people and cases", () => {
  it("validates_receipts_and_reuses_a_person_with_the_same_name", async () => {
    const { backend, alex } = await household();

    await expect(backend.addCase({ receiptNumber: "nope", personId: alex })).rejects.toThrow("3 letters followed by 10 numbers");
    const again = (await backend.addPerson({ name: " Alex " })) as { person: { id: string } };

    expect(again.person.id).toBe(alex);
    expect((await backend.getSummary()).people).toHaveLength(1);
  });

  it("deleting_a_case_removes_everything_that_hung_off_it", async () => {
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });
    const caseId = (await backend.getSummary()).cases[0].id;
    await backend.recordCaseFact(caseId, { kind: "appointment_attended", occurredOn: "2026-06-11", letterId: "400000001" });
    await backend.putNoticeDetails("400000001", { address: "100 Example Plaza" });

    await backend.deleteCase(caseId);
    const data = await backend.exportData();

    expect([data.cases, data.snapshots, data.changes, data.facts, data.noticeDetails].map((rows) => rows.length)).toEqual([0, 0, 0, 0, 0]);
    expect(data.people).toHaveLength(1);
  });

  it("replaces_an_appointment_answer_instead_of_keeping_both", async () => {
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });
    const caseId = (await backend.getSummary()).cases[0].id;

    await backend.recordCaseFact(caseId, { kind: "appointment_missed", occurredOn: "2026-06-11", letterId: "400000001" });
    await backend.recordCaseFact(caseId, { kind: "appointment_attended", occurredOn: "2026-06-12", letterId: "400000001" });

    const { facts } = await backend.getSummary();
    expect(facts.map((fact) => [fact.kind, fact.occurredOn])).toEqual([["appointment_attended", "2026-06-12"]]);
  });

  it("attaches_notice_details_to_the_case_the_notice_came_from", async () => {
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });
    const caseId = (await backend.getSummary()).cases[0].id;

    const { noticeDetail } = await backend.putNoticeDetails("400000001", { address: "100 Example Plaza" });

    expect(noticeDetail).toMatchObject({ letterId: "400000001", caseId, details: { address: "100 Example Plaza" } });
  });

  it("inherits_a_principals_profile_and_refuses_a_loop", async () => {
    const { backend, alex } = await household();
    const { person: sam } = (await backend.addPerson({ name: "Sam" })) as { person: { id: string } };

    await backend.patchPerson(alex, { category: " eb3 ", chargeability: "row", priority_date: "2024-09-12" });
    await backend.patchPerson(sam.id, { principal_person_id: alex });

    const people = (await backend.getSummary()).people;
    expect(people.find((p) => p.id === alex)!.profile).toMatchObject({ category: "EB3", chargeability: "ROW", priorityDate: "2024-09-12" });
    expect(people.find((p) => p.id === sam.id)!.profile).toMatchObject({
      category: null,
      effective: { category: "EB3", chargeability: "ROW", priorityDate: "2024-09-12" },
      inherited: { category: true, chargeability: true, priorityDate: true },
    });
    await expect(backend.patchPerson(alex, { principal_person_id: sam.id })).rejects.toThrow("loop of principals");
    await expect(backend.patchPerson(alex, { priority_date: "9/12/2024" })).rejects.toThrow("YYYY-MM-DD");
  });

  it("reports_that_push_is_off_because_nothing_can_send_it", async () => {
    const { backend } = await household();

    expect((await backend.getSummary()).config).toEqual({ pushEnabled: false, vapidPublicKey: null });
  });
});

describe("local backend: backup", () => {
  it("restores_into_an_empty_browser_exactly_what_was_backed_up", async () => {
    // The only way to move devices or survive a cleared browser, so it has to
    // carry the snapshots too: without them the next refresh would have nothing
    // to diff against and every old event would read as the baseline again.
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });
    await backend.importSnapshot({ raw: response(A485, { updatedAtTimestamp: "2026-09-29T21:14:00.000Z" }) });
    const backup = JSON.parse(JSON.stringify(await backend.exportData()));
    const before = await backend.getSummary();

    const other = tracker().backend;
    expect(await other.restoreData(backup)).toEqual({ people: 1, cases: 1 });

    const after = await other.getSummary();
    expect(after.cases).toEqual(before.cases);
    expect(after.people).toEqual(before.people);
    expect((await other.importSnapshot({ raw: response(A485, { updatedAtTimestamp: "2026-09-29T21:14:00.000Z" }) })).outcome).toBe("unchanged");
  });

  it("refuses_a_file_that_is_not_a_backup_without_erasing_anything", async () => {
    const { backend } = await household();

    await expect(backend.restoreData({ people: [] })).rejects.toThrow("not a USCIS Tracker backup");
    await expect(backend.restoreData({ format: BACKUP_FORMAT, version: 1, people: [] })).rejects.toThrow("not a USCIS Tracker backup");
    expect((await backend.getSummary()).people).toHaveLength(1);
  });

  it("erases_everything_on_request", async () => {
    const { backend } = await household();
    await backend.importSnapshot({ raw: response(A485) });

    await backend.eraseData();
    const data = await backend.exportData();

    expect([data.people, data.cases, data.snapshots, data.changes].map((rows) => rows.length)).toEqual([0, 0, 0, 0]);
  });
});

describe("bulletin source", () => {
  const row = { bulletin: "2026-10", chart: "final_action", kind: "employment", category: "EB3", country: "ROW", status: "date", date: "2023-06-01" };

  function host(state: { online: boolean; requests: string[] }) {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      state.requests.push(url);
      if (!state.online) throw new TypeError("Failed to fetch");
      if (url.endsWith("visa_bulletin.json")) return new Response(JSON.stringify([row]));
      return new Response("", { status: 404 });
    }) as typeof fetch;
  }

  it("asks_for_the_whole_dataset_and_never_a_persons_category", async () => {
    // A request for one category and country would tell the host which queue
    // this person is in. The files requested must be the same for everyone.
    const state = { online: true, requests: [] as string[] };
    const db = await openDatabase(new IDBFactory());
    const source = createBulletinSource(db, { base: "https://data.example/d", fetchImpl: host(state) });

    const dataset = await source.load();

    expect(dataset.bulletins.rows).toHaveLength(1);
    expect(state.requests.sort()).toEqual([
      "https://data.example/d/processing_times.csv",
      "https://data.example/d/uscis_chart.json",
      "https://data.example/d/visa_bulletin.json",
    ]);
  });

  it("serves_the_stored_copy_offline_and_refetches_only_when_stale", async () => {
    const state = { online: true, requests: [] as string[] };
    const factory = new IDBFactory();
    let time = 0;
    const open = async () => createBulletinSource(await openDatabase(factory), { base: "https://data.example/d", fetchImpl: host(state), now: () => time });

    await (await open()).load();
    const fetched = state.requests.length;

    // A new page load within the freshness window reads IndexedDB, not the network.
    state.online = false;
    time = 60 * 60 * 1000;
    expect((await (await open()).load()).bulletins.rows).toHaveLength(1);
    expect(state.requests).toHaveLength(fetched);

    // Stale and offline: the old copy still answers.
    time = 24 * 60 * 60 * 1000;
    expect((await (await open()).load()).bulletins.rows).toHaveLength(1);
  });

  it("answers_with_no_data_rather_than_failing_when_it_has_never_been_online", async () => {
    const db = await openDatabase(new IDBFactory());
    const source = createBulletinSource(db, { base: "https://data.example/d", fetchImpl: host({ online: false, requests: [] }) });

    expect(await source.load()).toEqual({ bulletins: { rows: [], uscisChart: {} }, processingTimes: [] });
  });
});
