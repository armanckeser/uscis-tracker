import { describe, expect, it } from "vitest";
import { buildHistory, mergeSharedEntries, quietKeys } from "../src/lib/history.js";
import { currentStatus, formLabel, toneForTag } from "../src/lib/uscisCopy.js";
import { caseSummary, change, event, noticeChange, silent } from "./support/v2.js";

describe("history classification", () => {
  const changes = [
    change({ changeType: "baseline", occurredAt: "2026-05-01T00:00:00.000Z" }),
    change({ changeType: "submission", occurredAt: "2026-04-29T04:00:00.000Z" }),
    event("IAF", "2026-05-04T19:00:00.000Z"),
    noticeChange("Appointment Scheduled", "2026-06-05T23:00:00.000Z", { appointmentDateTime: "2026-06-22T13:00:00.000Z" }),
    event("FTA0", "2026-06-22T15:00:00.000Z"),
    silent("2026-07-01T15:00:00.000Z"),
    silent("2026-07-10T15:00:00.000Z"),
    event("FTA0", "2026-08-05T15:00:00.000Z"),
  ];
  const merged = mergeSharedEntries([caseSummary(changes)]);

  it("treats_silent_updates_tracking_and_repeated_reads_as_quiet", () => {
    const quiet = quietKeys(merged);
    const titles = merged.filter((item) => quiet.has(item.key)).map((item) => item.entry.title);

    expect(titles.sort()).toEqual(["Actively reviewing", "Added to tracking", "Silent update", "Silent update"].sort());
  });

  it("keeps_the_first_report_of_a_step_meaningful_and_folds_its_repeat", () => {
    const { preview } = buildHistory(merged);

    expect(preview.map((item) => item.entry.title)).toEqual(["Actively reviewing", "Appointment scheduled", "Application filed"]);
    // The kept review entry is the first read (Jun 22), not the Aug 5 repeat.
    expect(preview[0].entry.occurredOn).toBe("2026-06-22");
  });

  it("folds_consecutive_quiet_entries_into_one_run_with_its_date_range", () => {
    const { blocks } = buildHistory(merged);
    const runs = blocks.filter((block) => block.type === "quiet");

    // Newest first: [Aug 5 repeat, Jul 10, Jul 1] is one run; "Added to tracking" is another.
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ from: "2026-07-01", to: "2026-08-05", count: 3 });
  });

  it("counts_every_entry_toward_the_full_history_total", () => {
    expect(buildHistory(merged).total).toBe(merged.length);
  });
});

describe("mergeSharedEntries", () => {
  it("shows_an_event_two_cases_share_once_naming_both", () => {
    const a = caseSummary([event("IAF", "2026-05-04T19:00:00.000Z", { caseId: "a" })], { id: "a" });
    const b = caseSummary([event("IAF", "2026-05-04T21:00:00.000Z", { caseId: "b" })], { id: "b", formType: "I-765" });

    const items = mergeSharedEntries([a, b]);

    expect(items).toHaveLength(1);
    expect(items[0].caseIds).toEqual(["a", "b"]);
    expect(items[0].members).toHaveLength(2);
  });

  it("merges_same_day_silent_updates_but_not_different_days", () => {
    const a = caseSummary([event("IAF", "2026-05-04T19:00:00.000Z", { caseId: "a" }), silent("2026-07-01T15:00:00.000Z", { caseId: "a" })], { id: "a" });
    const b = caseSummary([event("IAF", "2026-05-06T19:00:00.000Z", { caseId: "b" }), silent("2026-07-01T16:00:00.000Z", { caseId: "b" })], { id: "b" });

    // IAF is on different days (2 rows); the same-day silent updates fold into one.
    expect(mergeSharedEntries([a, b])).toHaveLength(3);
  });
});

describe("status copy", () => {
  it("reads_the_newest_real_movement_as_the_status", () => {
    const status = currentStatus(caseSummary([event("IAF", "2026-05-04T19:00:00.000Z"), event("FTA0", "2026-06-22T15:00:00.000Z"), silent("2026-08-01T00:00:00.000Z")]));

    expect(status.title).toBe("Actively reviewing");
    expect(status.tone).toBe("forward");
  });

  it("falls_back_to_the_stage_when_nothing_has_moved", () => {
    const status = currentStatus(caseSummary([change({ changeType: "baseline" })]));

    expect(status.title).toBe("Filed");
    expect(status.tone).toBe("waiting");
  });

  it("colours_by_meaning", () => {
    expect(toneForTag("approved")).toBe("good");
    expect(toneForTag("rfe")).toBe("bad");
    expect(toneForTag("denied")).toBe("bad");
    expect(toneForTag("biometrics")).toBe("forward");
    expect(toneForTag("filed")).toBe("waiting");
  });

  it("names_forms_and_falls_back_to_the_code", () => {
    expect(formLabel("I-485")).toBe("I-485 · Adjustment of status");
    expect(formLabel("I485")).toBe("I-485 · Adjustment of status");
    expect(formLabel("I-999")).toBe("I-999");
    expect(formLabel(null)).toBe("USCIS case");
  });
});
