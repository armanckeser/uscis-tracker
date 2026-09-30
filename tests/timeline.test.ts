import { describe, expect, it } from "vitest";
import { normalizeTimeline, type ChangeRecord, type FactRecord } from "../shared/timeline.js";
import { buildChanges } from "../server/domain.js";

let n = 0;
function change(over: Partial<ChangeRecord>): ChangeRecord {
  n += 1;
  return {
    id: `c${n}`,
    caseId: "case1",
    snapshotId: `s${n}`,
    changeType: "event",
    fieldPath: null,
    label: "",
    occurredAt: "2026-06-05T15:00:00.000Z",
    payload: {},
    source: "uscis",
    firstSeenAt: "2026-06-06T00:00:00.000Z",
    acknowledgedAt: null,
    ...over,
  };
}

const event = (code: string, at: string) =>
  change({ changeType: "event", fieldPath: `events[${code}]`, occurredAt: at, payload: { eventCode: code, eventId: `${code}${at}` } });

describe("normalizeTimeline", () => {
  it("collapses same-code events on the same local date and keeps every original", () => {
    const entries = normalizeTimeline([
      event("FTA0", "2026-06-05T14:00:00.000Z"),
      event("FTA0", "2026-06-05T15:00:00.000Z"),
      event("FTA0", "2026-06-05T16:00:00.000Z"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ code: "FTA0", count: 3, title: "Actively reviewing", significance: "step", occurredAt: "2026-06-05T16:00:00.000Z" });
    expect(entries[0].entries).toHaveLength(3);
  });

  it("does not collapse across local dates or across codes", () => {
    // 03:30Z on the 6th is still the evening of the 5th in New York.
    const entries = normalizeTimeline([
      event("FTA0", "2026-06-06T03:30:00.000Z"),
      event("FTA0", "2026-06-05T15:00:00.000Z"),
      event("FTA1", "2026-06-05T15:00:00.000Z"),
      event("FTA0", "2026-06-07T15:00:00.000Z"),
    ]);
    expect(entries.map((e) => [e.code, e.count, e.occurredOn])).toEqual([
      ["FTA0", 1, "2026-06-07"],
      ["FTA0", 2, "2026-06-05"],
      ["FTA1", 1, "2026-06-05"],
    ]);
  });

  it("classifies significance from the shared registry", () => {
    const entries = normalizeTimeline([
      event("IAF", "2026-01-01T15:00:00.000Z"),
      event("FTA0", "2026-01-02T15:00:00.000Z"),
      event("H008", "2026-01-03T15:00:00.000Z"),
      change({ changeType: "notice", occurredAt: "2026-01-04T15:00:00.000Z", payload: { actionType: "Request For Evidence Was Sent", letterId: "L1" } }),
      change({ changeType: "notice", occurredAt: "2026-01-05T15:00:00.000Z", payload: { actionType: "Case Was Transferred" } }),
      change({ changeType: "silent_update", source: "tracker", occurredAt: "2026-01-06T15:00:00.000Z" }),
      change({ changeType: "baseline", source: "tracker", occurredAt: "2026-01-07T15:00:00.000Z" }),
    ]);
    const by = Object.fromEntries(entries.map((e) => [e.code ?? e.kind, e.significance]));
    expect(by).toMatchObject({ IAF: "milestone", FTA0: "step", H008: "milestone", "Request For Evidence Was Sent": "milestone", "Case Was Transferred": "step", silent_update: "quiet", baseline: "quiet" });
  });

  it("shows unknown codes raw with the fallback meaning", () => {
    const [entry] = normalizeTimeline([event("ZZ9", "2026-01-01T15:00:00.000Z")]);
    expect(entry.title).toBe("ZZ9");
    expect(entry.meaning).toBe("USCIS recorded an update we don't have a description for yet.");
  });

  it("splits by source: tracker rows stay tracker, human facts are human, raw field rows never render", () => {
    const facts: FactRecord[] = [{ id: "f1", caseId: "case1", kind: "appointment_attended", occurredOn: "2026-06-22", letterId: "L1", note: null, createdAt: "2026-06-23T00:00:00.000Z" }];
    const entries = normalizeTimeline(
      [
        change({ changeType: "baseline", source: "tracker" }),
        change({ changeType: "silent_update", source: "tracker" }),
        change({ changeType: "field", source: "tracker", fieldPath: "updatedAt" }),
        event("FTA0", "2026-06-05T15:00:00.000Z"),
      ],
      facts,
    );
    expect(entries.map((e) => e.source).sort()).toEqual(["human", "tracker", "tracker", "uscis"]);
    expect(entries.find((e) => e.kind === "fact")).toMatchObject({ source: "human", title: "Appointment attended", occurredOn: "2026-06-22" });
    expect(entries.some((e) => e.entries.some((s) => s.payload && (s.payload as { x?: 1 }).x))).toBe(false);
  });

  it("collapses repeated silent updates on one day and marks unread", () => {
    const entries = normalizeTimeline([
      change({ changeType: "silent_update", source: "tracker", occurredAt: "2026-06-05T14:00:00.000Z", acknowledgedAt: "2026-06-06T00:00:00.000Z" }),
      change({ changeType: "silent_update", source: "tracker", occurredAt: "2026-06-05T18:00:00.000Z" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ count: 2, unread: true });
  });

  it("tags changes built by buildChanges with a source and no longer stores raw field rows", () => {
    const prev = { receiptNumber: "IOE1234567890", formType: "I-485", updatedAtTimestamp: "2026-01-01T00:00:00.000Z", events: [], notices: [] };
    const next = { ...prev, updatedAtTimestamp: "2026-02-01T00:00:00.000Z", actionCodeText: "x" };
    const changes = buildChanges(prev, next, "2026-02-01T00:00:00.000Z");
    expect(changes.map((c) => [c.changeType, c.source])).toEqual([["silent_update", "tracker"]]);
    const baseline = buildChanges(null, { ...prev, submissionTimestamp: "2026-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z");
    expect(baseline.map((c) => [c.changeType, c.source])).toEqual([["submission", "uscis"], ["baseline", "tracker"]]);
  });
});
