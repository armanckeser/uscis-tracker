import { describe, expect, it } from "vitest";
import { describeRefresh, parseRefreshHandoff, summarizeOutcome } from "../src/lib/refreshHandoff.js";
import { caseSummary, personSummary, silent, summaryOf } from "./support/v2.js";

// Alex and Sam each own two cases under separate myUSCIS accounts, and one
// bookmark covers all four. So a correct run always refuses half of them. These
// tests pin that the report says so instead of calling it a failure.

describe("describeRefresh", () => {
  it("leads_with_what_was_read_when_the_other_account_refused_the_rest", () => {
    // Regression guarded: the real run read Alex's 2 cases and was refused
    // Sam's 2, and the message was "2 cases could not be read from USCIS. Sign
    // in again and retry." It checked failures first and returned early, hiding the
    // success and prescribing a fix for a problem that did not exist.
    const { tone, message } = describeRefresh({ sent: 2, denied: 2, failed: 0, codes: "404" });

    expect(message).toBe(
      "2 cases read. 2 belong to the other USCIS account — sign in as them and refresh again.",
    );
    expect(tone).toBe("info");
  });

  it("reports_a_clean_single_account_run_without_mentioning_refusals", () => {
    const { tone, message } = describeRefresh({ sent: 4, denied: 0, failed: 0, codes: "" });

    expect(message).toBe("4 cases read.");
    expect(tone).toBe("info");
  });

  it("names_the_http_status_when_something_genuinely_broke", () => {
    // A refusal that is not an account boundary is worth surfacing with its code,
    // so an unexpected one can be diagnosed rather than guessed at.
    const { tone, message } = describeRefresh({ sent: 1, denied: 0, failed: 1, codes: "500" });

    expect(message).toBe("1 case read. 1 could not be read (HTTP 500).");
    expect(tone).toBe("error");
  });

  it("treats_reading_nothing_as_an_error_even_when_every_refusal_was_expected", () => {
    const { tone, message } = describeRefresh({ sent: 0, denied: 2, failed: 0, codes: "404" });

    expect(message).toBe(
      "No cases were read. 2 belong to the other USCIS account — sign in as them and refresh again.",
    );
    expect(tone).toBe("error");
  });

  it("tells_an_empty_run_where_the_cases_are_listed", () => {
    const { tone, message } = describeRefresh({ sent: 0, denied: 0, failed: 0, codes: "" });

    expect(message).toBe("No cases were found. Sign in to myUSCIS, open the page that lists your cases, then tap refresh again.");
    expect(tone).toBe("error");
  });

  it("uses_singular_wording_for_one_of_each", () => {
    expect(describeRefresh({ sent: 1, denied: 1, failed: 0, codes: "404" }).message).toBe(
      "1 case read. 1 belongs to the other USCIS account — sign in as them and refresh again.",
    );
  });

  // Regression guarded: a run that read both cases and stored nothing said only
  // "2 cases read.", which is what a run whose imports were being dropped would
  // also say. There was no way to tell a quiet case from a broken pipeline.
  it("says_nothing_new_and_dates_the_last_movement_when_the_read_stored_nothing", () => {
    const { tone, message } = describeRefresh(
      { sent: 2, denied: 2, failed: 0, codes: "404" },
      { newChanges: 0, lastMovementIso: "2026-07-21T18:00:00.000Z" },
    );

    expect(message).toBe(
      "2 cases read. 2 belong to the other USCIS account — sign in as them and refresh again. Nothing new since Jul 21.",
    );
    expect(tone).toBe("info");
  });

  it("stays_quiet_about_silence_when_something_did_arrive", () => {
    // The new-since panel reports what arrived. Saying it here too would either
    // duplicate it or, worse, contradict it.
    expect(
      describeRefresh({ sent: 2, denied: 0, failed: 0, codes: "" }, { newChanges: 1, lastMovementIso: "2026-07-21T18:00:00.000Z" }).message,
    ).toBe("2 cases read.");
  });

  it("does_not_date_the_silence_when_no_case_has_ever_moved", () => {
    expect(
      describeRefresh({ sent: 1, denied: 0, failed: 0, codes: "" }, { newChanges: 0, lastMovementIso: null }).message,
    ).toBe("1 case read. Nothing new.");
  });

  it("never_claims_silence_on_a_run_that_failed_a_read", () => {
    // A failed read means part of the picture is missing, so "nothing new" would
    // be a claim the run cannot support.
    expect(
      describeRefresh({ sent: 1, denied: 0, failed: 1, codes: "500" }, { newChanges: 0, lastMovementIso: "2026-07-21T18:00:00.000Z" }).message,
    ).toBe("1 case read. 1 could not be read (HTTP 500).");
  });

  it("omits_the_silence_claim_when_the_outcome_could_not_be_read_back", () => {
    expect(describeRefresh({ sent: 2, denied: 0, failed: 0, codes: "" }, null).message).toBe("2 cases read.");
  });
});

describe("summarizeOutcome", () => {
  function summaryWith(unread: boolean) {
    const changes = [silent("2026-07-21T18:00:00.000Z", unread ? { acknowledgedAt: null } : {})];
    return summaryOf([personSummary()], [caseSummary(changes, { lastChangedAt: "2026-07-21T18:00:00.000Z" })]);
  }

  it("counts_an_unread_silent_update_as_something_new", () => {
    expect(summarizeOutcome(summaryWith(true))).toEqual({
      newChanges: 1,
      lastMovementIso: "2026-07-21T18:00:00.000Z",
    });
  });

  it("reports_a_read_case_as_quiet_while_still_dating_its_last_movement", () => {
    expect(summarizeOutcome(summaryWith(false))).toEqual({
      newChanges: 0,
      lastMovementIso: "2026-07-21T18:00:00.000Z",
    });
  });
});

describe("parseRefreshHandoff", () => {
  it("reads_the_counts_and_codes_the_script_appended", () => {
    expect(parseRefreshHandoff("?sent=2&denied=2&failed=0&codes=404")).toEqual({
      sent: 2,
      denied: 2,
      failed: 0,
      codes: "404",
    });
  });

  it("returns_null_when_this_was_not_a_refresh_handoff", () => {
    // Regression guarded: without this the toast would fire on an ordinary visit.
    expect(parseRefreshHandoff("")).toBeNull();
    expect(parseRefreshHandoff("?other=1")).toBeNull();
  });

  it("treats_a_malformed_count_as_zero_rather_than_rendering_NaN", () => {
    expect(parseRefreshHandoff("?sent=abc&denied=2")).toEqual({
      sent: 0,
      denied: 2,
      failed: 0,
      codes: "",
    });
  });
});
