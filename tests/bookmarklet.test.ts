import { describe, expect, it } from "vitest";
import {
  buildImportFallbackBookmarklet,
  buildRefreshBookmarklet,
  buildShortcutScript,
} from "../src/lib/bookmarklet.js";

const TRACKER = "https://uscis.example.com";

describe("refresh bookmarklet builder", () => {
  it("embeds_the_tracker_origin_and_exact_receipts_when_cases_exist", () => {
    // Regression guarded: if the generated bookmarklet targets the wrong origin
    // or embeds the wrong receipts, a tap silently posts case data to the wrong
    // server or refreshes the wrong cases. These are the load-bearing literals,
    // asserted against fixed expected substrings (not re-derived).
    const result = buildRefreshBookmarklet({
      trackerOrigin: TRACKER,
      receipts: ["IOE1234567801", "IOE1234567802"],
    });

    expect(result.startsWith("javascript:")).toBe(true);
    expect(result).toContain(`const T="https://uscis.example.com"`);
    expect(result).toContain(`R=["IOE1234567801","IOE1234567802"]`);
    expect(result).toContain(`"/account/case-service/api/cases/"`);
    expect(result).toContain(`"/api/snapshots/import"`);
    // The import POST must be a no-cors simple request so the reverse proxy's
    // CORS rewrite cannot block it (Cosmos overwrites Allow-Origin on the
    // public domain). Regression: a json/preflighted POST would be blocked.
    expect(result).toContain(`mode:"no-cors"`);
    expect(result).toContain(`"Content-Type":"text/plain"`);
    expect(result).not.toContain(`"Content-Type":"application/json"`);
  });

  it("carries_no_person_identity_so_one_bookmark_serves_both_accounts", () => {
    // Regression guarded: the bookmarklet used to embed a personId, which forced
    // one bookmark per person and let a stale bookmark attribute a snapshot to
    // the wrong one. The import endpoint derives the owner from the receipt in
    // the response, so identity must not appear in the script at all.
    const result = buildRefreshBookmarklet({
      trackerOrigin: TRACKER,
      receipts: ["IOE1234567801"],
    });

    expect(result).not.toContain("personId");
  });

  it("counts_a_refused_case_and_keeps_going_instead_of_aborting_the_run", () => {
    // Regression guarded: it used to break out of the loop on the first
    // 401/403. With every tracked receipt in one bookmark, the other person's
    // cases are always refused, so aborting there would mean the signed-in
    // person's remaining cases were never read.
    const result = buildRefreshBookmarklet({
      trackerOrigin: TRACKER,
      receipts: ["IOE1234567801", "IOE1234567802"],
    });

    expect(result).not.toContain("break;");
    // Only a run that read nothing at all falls back to the raw-page route.
    expect(result).toContain("if(G.length===0&&denied>0)");
  });

  it("counts_404_as_the_other_account_not_as_a_failure", () => {
    // Regression guarded: USCIS scopes cases by account, so a receipt from the
    // other person's account is refused with 404. Counting that as a failure made
    // a correct two-account run report "2 cases could not be read from USCIS.
    // Sign in again and retry."
    const result = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result).toContain("res.status===401||res.status===403||res.status===404){denied++;}else{failed++;}");
  });

  it("hands_back_all_three_counts_and_the_refusal_statuses", () => {
    // The tracker cannot describe the run honestly from a single number, and an
    // unexpected status has to be diagnosable rather than guessed at.
    const result = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result).toContain('"/?sent="+sent+"&denied="+denied+"&failed="+failed');
    expect(result).toContain('"&codes="+C.join("-")');
  });

  it("hands_off_to_the_tracker_with_counts_rather_than_claiming_an_import", () => {
    // Regression guarded: the no-cors response is opaque, so the script cannot
    // know what the server stored. It used to alert "N sent", which read as "N
    // imported" and hid every rejected import.
    const result = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result).toContain(`location.href=T+"/?sent="+sent`);
    expect(result).not.toContain("alert(\"USCIS Tracker: \"+sent");
    expect(result).toContain(`mode:"no-cors"`);
  });

  it("is_a_working_bookmark_before_any_case_is_tracked", () => {
    // Regression guarded: with nothing tracked this used to be an alert saying
    // so, which made typing a receipt number the only way to start. The bookmark
    // a new user saves has to be the one that finds their cases.
    const result = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [] });

    expect(result).toContain("R=[]");
    expect(result).not.toContain("no cases are being tracked");
    expect(result).toContain("document.documentElement.innerHTML");
    expect(result).toContain(`fetch("/account/case-service/api/cases",`);
  });

  it("only_counts_a_refusal_for_a_receipt_it_already_knew", () => {
    // Regression guarded: receipt-shaped text on a page is not always a case.
    // Counting such a candidate's 404 would report "1 belongs to the other USCIS
    // account" about something that was never a case at all.
    const result = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result).toContain("if(!res.ok){if(!k)continue;");
  });

  it("escapes_interpolated_values_so_a_hostile_receipt_cannot_break_the_string", () => {
    // Regression guarded: a receipt containing a quote/backslash must not
    // terminate the JS string literal early (which would corrupt the bookmarklet
    // or allow injection). JSON.stringify quoting is the defense.
    const result = buildRefreshBookmarklet({
      trackerOrigin: TRACKER,
      receipts: ['IOE"injected'],
    });

    expect(result).toContain('R=["IOE\\"injected"]');
    expect(result).not.toContain('R=["IOE"injected"]');
  });
});

describe("import-fallback bookmarklet builder", () => {
  it("posts_parsed_page_json_to_the_tracker_import_endpoint", () => {
    // Regression guarded: the iOS fallback must read the JSON the page is showing
    // and post it to the right tracker, or the manual import lands nowhere.
    const result = buildImportFallbackBookmarklet(TRACKER);

    expect(result.startsWith("javascript:")).toBe(true);
    expect(result).toContain(`const T="https://uscis.example.com"`);
    expect(result).toContain("JSON.parse(document.body.innerText)");
    expect(result).toContain(`"/api/snapshots/import"`);
    expect(result).toContain(`mode:"no-cors"`);
    expect(result).toContain(`"Content-Type":"text/plain"`);
    expect(result).not.toContain("personId");
  });
});

describe("iOS Shortcut script builder", () => {
  it("calls_completion_so_the_shortcut_does_not_hang", () => {
    // Regression guarded: the "Run JavaScript on Webpage" action does not return
    // the last expression. If completion() is never called the shortcut hangs
    // until Safari kills it, which reads to the user as "the refresh broke".
    const result = buildShortcutScript({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result).toContain("completion(");
    // Every exit path reports, including the wrong-site guard.
    expect(result).toContain('completion("Open my.uscis.gov first, then share this page.")');
  });

  it("is_not_a_javascript_url_because_the_action_takes_a_bare_script", () => {
    const result = buildShortcutScript({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result.startsWith("javascript:")).toBe(false);
    expect(result.startsWith("(async()=>{")).toBe(true);
  });

  it("wraps_the_work_in_an_async_iife_rather_than_relying_on_top_level_await", () => {
    // Top-level await is not reliable in that action, so the await must live
    // inside the IIFE.
    const result = buildShortcutScript({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result).toContain("(async()=>{");
    expect(result).toContain("})();");
  });

  it("reports_delivery_rather_than_claiming_an_import_it_cannot_observe", () => {
    const result = buildShortcutScript({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(result).toContain("Open the tracker to see what changed.");
    expect(result).toContain(`mode:"no-cors"`);
  });

  it("shares_the_bookmarklets_read_loop_so_the_two_cannot_drift", () => {
    // Regression guarded: both scripts carried their own copy of the loop, and a
    // fix to the refusal classification landed in the bookmarklet only -- leaving
    // the Shortcut referencing a variable its own copy never declared.
    const shortcut = buildShortcutScript({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });
    const bookmarklet = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    const loop = "let sent=0,denied=0,failed=0;const C=[],D=[],G=[];";
    expect(shortcut).toContain(loop);
    expect(bookmarklet).toContain(loop);
    expect(shortcut).toContain("res.status===404){denied++;}else{failed++;}");
  });

  it("does_not_go_looking_for_cases_it_would_have_nowhere_to_put", () => {
    // The self-hosted Shortcut ends in a sentence, not a trip to the tracker, so
    // a case it found could not be handed over. It must not read one and drop it.
    const shortcut = buildShortcutScript({ trackerOrigin: TRACKER, receipts: ["IOE1234567801"] });

    expect(shortcut).not.toContain("innerHTML");
    expect(shortcut).not.toContain("localStorage");
  });
});
