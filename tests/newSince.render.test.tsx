import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { NewSincePanel } from "../src/features/timeline/NewSincePanel.js";
import type { CaseSummary } from "../src/lib/types.js";
import { caseSummary, noticeChange, silent } from "./support/v2.js";

// The panel exists because the history answers the wrong question. It is
// ordered by when USCIS acted, so a silent update USCIS backdates lands below
// rows already read. This surface orders by when we found out instead, and
// "read" actually hides a row.

const NOW = new Date("2026-07-26T12:00:00.000Z");
const unread = { acknowledgedAt: null };

// renderToString emits `<!-- -->` separators between adjacent interpolated text
// nodes. Stripping them lets assertions read as the sentence a user sees.
function render(cases: CaseSummary[]) {
  return renderToString(<NewSincePanel cases={cases} refresh={async () => null} showToast={() => {}} />).replaceAll("<!-- -->", "");
}

describe("NewSincePanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists_an_unread_change_with_who_and_when_we_found_it", () => {
    const html = render([caseSummary([silent("2026-07-10T18:22:00.000Z", { ...unread, firstSeenAt: "2026-07-26T11:00:00.000Z" })])]);

    expect(html).toContain("1 change since you last looked");
    expect(html).toContain("Silent update");
    expect(html).toContain("Alex · I-485");
    expect(html).toContain("found 1h ago");
    expect(html).toContain("Acknowledge");
  });

  it("orders_by_when_we_found_out_not_when_uscis_acted", () => {
    // The one USCIS dated EARLIER but we found LATER must come first.
    const html = render([
      caseSummary([
        noticeChange("Case Was Approved", "2026-07-20T00:00:00.000Z", {}, { ...unread, firstSeenAt: "2026-07-24T00:00:00.000Z" }),
        noticeChange("Appointment Scheduled", "2026-07-01T00:00:00.000Z", {}, { ...unread, firstSeenAt: "2026-07-26T11:00:00.000Z" }),
      ]),
    ]);

    expect(html.indexOf("Appointment scheduled")).toBeLessThan(html.indexOf("Case approved"));
  });

  it("hides_a_change_that_has_been_acknowledged", () => {
    expect(render([caseSummary([silent("2026-07-10T18:22:00.000Z")])])).toBe("");
  });

  it("renders_nothing_when_there_is_no_case", () => {
    expect(render([])).toBe("");
  });
});
