import { describe, expect, it } from "vitest";
import { lastMovementAt, unreadEntries } from "../src/lib/unread.js";
import { caseSummary, change, event, noticeChange, silent } from "./support/v2.js";

// The row that went missing once: on 2026-07-21 USCIS advanced the I-485's clock
// with no status, event, or notice. Nothing reported it, so the household
// concluded the import was broken. A silent update stays news.

const unread = { acknowledgedAt: null };

describe("unreadEntries", () => {
  it("lists_an_unread_silent_update_because_it_is_the_only_report_of_quiet_movement", () => {
    const rows = unreadEntries([caseSummary([silent("2026-07-21T04:20:03.300Z", unread)])]);

    expect(rows).toHaveLength(1);
    expect(rows[0].entry.kind).toBe("silent_update");
  });

  it("omits_added_to_tracking_because_that_is_an_app_event_not_news", () => {
    const rows = unreadEntries([caseSummary([change({ changeType: "baseline", ...unread })])]);

    expect(rows).toEqual([]);
  });

  it("omits_an_entry_that_has_been_read", () => {
    expect(unreadEntries([caseSummary([silent("2026-07-21T04:20:03.300Z")])])).toEqual([]);
  });

  it("orders_by_when_we_found_out_not_when_USCIS_acted", () => {
    // A backdated silent update is discovered after a notice USCIS dated later.
    // Sorting by `occurredAt` would bury the news under something already read.
    const rows = unreadEntries([
      caseSummary([
        noticeChange("Appointment Scheduled", "2026-07-25T00:00:00.000Z", {}, { ...unread, firstSeenAt: "2026-07-25T01:00:00.000Z" }),
        silent("2026-07-21T04:20:03.300Z", { ...unread, firstSeenAt: "2026-07-26T21:41:47.000Z" }),
      ]),
    ]);

    expect(rows.map((row) => row.entry.kind)).toEqual(["silent_update", "notice"]);
  });

  it("counts_a_folded_burst_once", () => {
    const rows = unreadEntries([
      caseSummary([
        event("FTA0", "2026-06-05T14:00:00.000Z", unread),
        event("FTA0", "2026-06-05T16:00:00.000Z", unread),
      ]),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].entry.count).toBe(2);
  });
});

describe("lastMovementAt", () => {
  it("reports_the_newest_date_USCIS_acted_on_across_cases", () => {
    const moment = lastMovementAt([
      { lastChangedAt: "2026-06-22T13:37:50.039Z" },
      { lastChangedAt: "2026-07-21T04:20:03.300Z" },
      { lastChangedAt: null },
    ]);

    expect(moment).toBe("2026-07-21T04:20:03.300Z");
  });

  it("returns_null_when_no_case_has_ever_moved", () => {
    expect(lastMovementAt([])).toBeNull();
    expect(lastMovementAt([{ lastChangedAt: null }])).toBeNull();
  });
});
