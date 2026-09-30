import { describe, expect, it } from "vitest";
import {
  UscisSessionError,
  buildChanges,
  computeJsonDiff,
  hashCaseData,
  isValidReceipt,
  normalizeUscisResponse,
} from "../server/domain.js";

const baseline = {
  receiptNumber: "IOE1234567890",
  formType: "I-485",
  caseStatus: "Case Was Received",
  submissionTimestamp: "2026-01-01T15:00:00.000Z",
  updatedAtTimestamp: "2026-01-01T15:00:00.000Z",
  closed: false,
  events: [
    { eventId: "e1", eventCode: "FTA0", createdAtTimestamp: "2026-01-02T15:00:00.000Z" },
  ],
  notices: [],
};

describe("USCIS domain logic", () => {
  it("validates receipt numbers", () => {
    expect(isValidReceipt("IOE1234567890")).toBe(true);
    expect(isValidReceipt("IOE123")).toBe(false);
    expect(isValidReceipt("123IOE1234567")).toBe(false);
  });

  it("normalizes wrapped USCIS API responses", () => {
    expect(normalizeUscisResponse({ data: baseline }).receiptNumber).toBe("IOE1234567890");
    expect(() => normalizeUscisResponse({ data: null })).toThrow(/empty response/);
  });

  it("raises_UscisSessionError_when_response_signals_a_dead_session", () => {
    // Regression guarded: a rejected session used to surface as a plain Error,
    // so the poller could not tell "reconnect needed" from a transient blip and
    // kept replaying the dead cookie to USCIS every 30 minutes. The typed error
    // is the single source of truth the poller branches on to auto-pause.
    expect(() => normalizeUscisResponse({ error: "unauthorized" })).toThrow(UscisSessionError);
    expect(() => normalizeUscisResponse({ data: null })).toThrow(UscisSessionError);
  });

  it("does_not_raise_UscisSessionError_for_a_valid_case_body", () => {
    // A healthy response must never be misclassified as a dead session, or a
    // working case would be auto-paused and stop polling.
    expect(() => normalizeUscisResponse({ data: baseline })).not.toThrow();
  });

  it("hashes equivalent data with stable key order", () => {
    const a = { receiptNumber: "IOE1234567890", formType: "I-485" };
    const b = { formType: "I-485", receiptNumber: "IOE1234567890" };
    expect(hashCaseData(a)).toBe(hashCaseData(b));
  });

  it("diffs new events by eventId and notices by letterId", () => {
    const next = {
      ...baseline,
      events: [
        ...baseline.events,
        { eventId: "e2", eventCode: "SA", createdAtTimestamp: "2026-02-01T15:00:00.000Z" },
      ],
      notices: [
        { letterId: "n1", actionType: "ApprovalNotice", generationDate: "2026-02-01T15:00:00.000Z" },
      ],
    };
    const diff = computeJsonDiff(baseline, next);
    expect(diff.map((item) => item.path)).toEqual(["events[SA]", "notices[ApprovalNotice]"]);
  });

  it("builds user-facing changes for meaningful updates", () => {
    const next = {
      ...baseline,
      caseStatus: "Case Approved",
      closed: true,
      updatedAtTimestamp: "2026-02-01T15:00:00.000Z",
      events: [
        ...baseline.events,
        { eventId: "e2", eventCode: "SA", createdAtTimestamp: "2026-02-01T15:00:00.000Z" },
      ],
    };
    const changes = buildChanges(baseline, next, "2026-02-01T15:00:00.000Z");
    expect(changes.some((change) => change.changeType === "status" && change.severity === "success")).toBe(true);
    expect(changes.some((change) => change.changeType === "event" && change.label.includes("Status adjusted"))).toBe(true);
  });

  it("explains_iaf_event_code_when_uscis_returns_internal_activity", () => {
    // Regression guarded: Activity timeline rows showed only "IAF", leaving the user with an unexplained USCIS acronym.
    const next = {
      ...baseline,
      updatedAtTimestamp: "2026-02-01T15:00:00.000Z",
      events: [
        ...baseline.events,
        { eventId: "e2", eventCode: "IAF", createdAtTimestamp: "2026-02-01T15:00:00.000Z" },
      ],
    };
    const changes = buildChanges(baseline, next, "2026-02-01T15:00:00.000Z");
    expect(changes).toContainEqual(expect.objectContaining({
      changeType: "event",
      fieldPath: "events[IAF]",
      label: "I-485 new event: Application filed",
      severity: "info",
    }));
  });

  it("records a silent update when only the USCIS updated timestamp moves", () => {
    const next = {
      ...baseline,
      updatedAtTimestamp: "2026-02-01T15:00:00.000Z",
    };
    const changes = buildChanges(baseline, next, "2026-02-01T15:05:00.000Z");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      changeType: "silent_update",
      fieldPath: "updatedAtTimestamp",
      label: "I-485 silent update",
      occurredAt: "2026-02-01T15:00:00.000Z",
    });
  });

  it("records_a_silent_update_when_the_case_clock_moves_alongside_an_unnamed_field", () => {
    // Regression guarded: a silent update used to require the diff to be
    // otherwise completely empty. In practice USCIS moves the clock and some
    // incidental field together, which produced only a `field` change — and the
    // timeline rail filters `field` out of view, so real movement was recorded
    // in Postgres and never shown to the user.
    const next = {
      ...baseline,
      updatedAtTimestamp: "2026-02-01T15:00:00.000Z",
      actionCodeText: "Case Is Being Actively Reviewed By USCIS",
    };

    const changes = buildChanges(baseline, next, "2026-02-01T15:05:00.000Z");

    const silent = changes.find((change) => change.changeType === "silent_update");
    expect(silent).toMatchObject({
      fieldPath: "updatedAtTimestamp",
      occurredAt: "2026-02-01T15:00:00.000Z",
    });
    expect(silent?.payload).toMatchObject({ caseClockAdvanced: true, alsoChanged: ["actionCodeText"] });
  });

  it("records_a_silent_update_when_a_field_moves_without_the_case_clock", () => {
    // A field can change while USCIS leaves updatedAtTimestamp alone. That is
    // still unnamed movement and must not be invisible.
    const next = { ...baseline, actionCodeText: "Case Is Being Actively Reviewed By USCIS" };

    const changes = buildChanges(baseline, next, "2026-02-01T15:05:00.000Z");

    expect(changes.find((change) => change.changeType === "silent_update")?.payload).toMatchObject({
      caseClockAdvanced: false,
      alsoChanged: ["actionCodeText"],
    });
  });

  it("does_not_record_a_silent_update_when_uscis_named_the_movement", () => {
    // The point of the row is movement USCIS did not name. A new notice names
    // it, so adding a silent-update row alongside would double-report it.
    const next = {
      ...baseline,
      updatedAtTimestamp: "2026-02-01T15:00:00.000Z",
      actionCodeText: "Case Is Being Actively Reviewed By USCIS",
      notices: [{ letterId: "n1", actionType: "ApprovalNotice", generationDate: "2026-02-01T15:00:00.000Z" }],
    };

    const changes = buildChanges(baseline, next, "2026-02-01T15:05:00.000Z");

    expect(changes.some((change) => change.changeType === "notice")).toBe(true);
    expect(changes.some((change) => change.changeType === "silent_update")).toBe(false);
  });

  it("records_no_changes_when_the_response_is_identical", () => {
    expect(buildChanges(baseline, { ...baseline }, "2026-02-01T15:05:00.000Z")).toEqual([]);
  });
});
