import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { TimelineView } from "../src/features/timeline/TimelineView.js";
import type { FoundCase } from "../src/lib/refreshHandoff.js";
import { caseSummary, change, event, noticeChange, personSummary, silent, summaryOf } from "./support/v2.js";

// Guards the status board against regressions in what it surfaces from a real
// I-485 history: the status card leads with the newest real movement, the
// history collapses to meaningful entries, silent updates fold into one quiet
// row, and the person with no profile gets a designed setup card.

const NOW = new Date("2026-09-29T12:00:00.000Z");

function i485Changes(caseId = "case-1") {
  const at = { caseId };
  return [
    change({ changeType: "baseline", occurredAt: "2026-05-01T00:00:00.000Z", ...at }),
    change({ changeType: "submission", fieldPath: "submissionTimestamp", occurredAt: "2026-04-29T04:00:00.000Z", ...at }),
    event("IAF", "2026-05-04T19:15:57.315Z", at),
    noticeChange("Appointment Scheduled", "2026-06-05T23:48:45.573Z", { letterId: "400000001", appointmentDateTime: "2026-06-22T13:00:00.000Z" }, at),
    event("FTA0", "2026-06-22T15:00:00.000Z", at),
    event("FTA0", "2026-06-22T17:00:00.000Z", at),
    event("FTA0", "2026-08-05T15:00:00.000Z", at),
    silent("2026-07-21T18:00:00.000Z", at),
    change({ changeType: "field", fieldPath: "updatedAtTimestamp", occurredAt: "2026-07-21T18:00:00.000Z", ...at }),
  ];
}

function render(cases = [caseSummary(i485Changes())], people = [personSummary()], found: FoundCase[] = []) {
  return renderToString(
    <TimelineView
      summary={summaryOf(people, cases)}
      showToast={() => {}}
      refresh={async () => null}
      onOpenSnapshot={async () => {}}
      onOpenConnection={() => {}}
      found={found}
      onAssignFound={async () => {}}
      onDismissFound={() => {}}
    />,
  ).replaceAll("<!-- -->", "");
}

describe("TimelineView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("leads_the_case_card_with_the_current_status_and_what_it_means", () => {
    const html = render();

    expect(html).toContain("I-485 · Adjustment of status");
    expect(html).toContain("Actively reviewing");
    expect(html).toContain("An officer has your file");
    expect(html).toContain("Stage 3 of 7");
  });

  it("no_longer_leads_with_an_open_uscis_hero", () => {
    const html = render();

    expect(html).not.toContain("Sign in, tap your refresh bookmark");
    expect(html).not.toContain("refresh-header");
  });

  it("collapses_history_to_the_meaningful_entries_and_offers_the_rest", () => {
    const html = render();

    expect(html).toContain("Show full history (");
    expect(html).toContain("Appointment scheduled");
    // The silent update and "added to tracking" are quiet: never in the preview.
    expect(html).not.toContain("Silent update");
    expect(html).not.toContain("Added to tracking");
  });

  it("keeps_raw_field_diffs_and_stored_labels_out", () => {
    const html = render();

    expect(html).not.toContain("Field changed");
    expect(html).not.toContain("changed updatedAtTimestamp");
  });

  it("shows_a_designed_setup_card_when_the_person_has_no_priority_date", () => {
    const html = render();

    expect(html).toContain("Add priority date to see predictions");
  });

  it("offers_an_add_person_action_and_the_status_facts", () => {
    const html = render();

    expect(html).toContain("Add a person");
    expect(html).toContain("Filed");
    expect(html).toContain("153 days ago");
  });

  it("shows_an_event_two_cases_share_once_and_names_both", () => {
    const i485 = caseSummary(i485Changes("case-1"), { id: "case-1", formType: "I-485" });
    const i765 = caseSummary(i485Changes("case-2"), { id: "case-2", formType: "I-765", receiptNumber: "IOE1234567802" });
    const html = render([i485, i765]);

    expect(html.match(/Application filed/g)).toHaveLength(1);
    expect(html).toContain("I-485 · I-765");
  });

  it("walks_a_person_with_no_cases_to_the_bookmark_instead_of_a_receipt_form", () => {
    // Regression guarded: this used to say "Add a receipt number for Alex"
    // beside a "+ Case" button, so the first thing a new user did was type a
    // receipt number by hand. The bookmark finds the cases; it comes first.
    vi.stubGlobal("window", { location: { origin: "https://uscis.example.com" } });
    const html = render([], [personSummary()]);

    expect(html).toContain("Bring in Alex&#x27;s cases");
    expect(html).toContain("Refresh cases");
    expect(html).toContain("Sign in to myUSCIS");
    expect(html).toContain("Enter a receipt number instead");
    expect(html).not.toContain("Add a case for Alex");
  });

  it("tells_a_second_person_to_sign_in_as_themselves_without_repeating_the_setup", () => {
    vi.stubGlobal("window", { location: { origin: "https://uscis.example.com" } });
    const html = render([caseSummary(i485Changes())], [personSummary(), personSummary({ id: "p2", name: "Sam", caseCount: 0 })]);

    expect(html).toContain("No cases for Sam yet.");
    expect(html).not.toContain("Bring in Sam");
    // Alex has cases, so typing one in stays available on his header.
    expect(html).toContain("Add a case for Alex");
  });

  it("asks_whose_the_cases_a_refresh_found_are", () => {
    const found = [{ raw: {}, receiptNumber: "IOE9912345777", formType: "I-765" }];
    const html = render([caseSummary(i485Changes())], [personSummary(), personSummary({ id: "p2", name: "Sam" })], found);

    expect(html).toContain("1 new case found on USCIS");
    expect(html).toContain("IOE9912345777");
    expect(html).toContain("Whose is it?");
    expect(html).toContain("Don&#x27;t track it");
  });
});
