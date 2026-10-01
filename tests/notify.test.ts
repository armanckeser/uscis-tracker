import { describe, expect, it } from "vitest";
import { buildChanges } from "../shared/domain.js";
import { selectNotifiable } from "../server/notify.js";

const prev = { receiptNumber: "IOE1234567890", formType: "I-485", caseStatus: "Case Was Received", updatedAtTimestamp: "2026-01-01T15:00:00.000Z", closed: false, events: [], notices: [] };

describe("notification filter", () => {
  it("a silent update does not push", () => {
    const changes = buildChanges(prev, { ...prev, updatedAtTimestamp: "2026-02-01T15:00:00.000Z", extra: "x" }, "2026-02-01T15:00:00.000Z");
    expect(changes.map((c) => c.changeType)).toEqual(["silent_update"]);
    expect(selectNotifiable(changes, "case1", "I-485")).toEqual([]);
  });

  it("tracker-source changes never push, whatever their type", () => {
    const changes = buildChanges(null, { ...prev, submissionTimestamp: "2026-01-01T15:00:00.000Z" }, "2026-01-01T15:00:00.000Z");
    expect(selectNotifiable(changes.filter((c) => c.source === "tracker"), "case1", "I-485")).toEqual([]);
  });

  it("pushes USCIS milestones and steps, collapsing same-code repeats on one day under one tag", () => {
    const next = {
      ...prev,
      updatedAtTimestamp: "2026-02-01T15:00:00.000Z",
      events: [
        { eventId: "a", eventCode: "FTA0", createdAtTimestamp: "2026-02-01T14:00:00.000Z" },
        { eventId: "b", eventCode: "FTA0", createdAtTimestamp: "2026-02-01T15:00:00.000Z" },
      ],
      notices: [{ letterId: "L1", actionType: "Case Was Approved", generationDate: "2026-02-01T16:00:00.000Z" }],
    };
    const items = selectNotifiable(buildChanges(prev, next, "2026-02-01T17:00:00.000Z"), "case1", "I-485");
    expect(items.map((i) => i.tag)).toEqual(["case:case1:FTA0:2026-02-01", "case:case1:Case Was Approved:2026-02-01"]);
    expect(items[0].covers).toHaveLength(2);
    expect(items[1].title).toBe("I-485: Case approved");
  });
});
