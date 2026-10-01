import { describe, expect, it } from "vitest";
import { buildImportFallbackBookmarklet, buildRefreshBookmarklet, buildShortcutScript } from "../src/lib/bookmarklet.js";
import { ENCODER_JS, decodeHandoff, readHandoffFragment } from "../src/lib/handoff.js";
import { combineHandoffs, describeRefresh, parseRefreshHandoff, storeHandoff, type TrackerState } from "../src/lib/refreshHandoff.js";
import { routeFromPath, routeHref } from "../src/hooks/useRoute.js";

// The browser-only tracker has no server, so the refresh script carries the
// cases back in the URL fragment. These tests run the generated scripts for
// real, against a stand-in for a signed-in my.uscis.gov tab.

const TRACKER = "https://example.github.io/uscis-tracker/";
const MINE = "IOE9912345601";
const THEIRS = "IOE9912345603";

const caseBody = (receiptNumber: string) => ({
  data: {
    receiptNumber,
    formType: "I-485",
    caseStatus: "Case Was Received",
    updatedAtTimestamp: "2026-06-11T16:20:00.000Z",
    events: Array.from({ length: 12 }, (_, i) => ({ eventId: `e${i}`, eventCode: "FTA0", createdAtTimestamp: "2026-06-11T16:20:00.000Z" })),
    notices: [{ letterId: "400000001", actionType: "Receipt Notice Was Sent", generationDate: "2026-05-01T09:00:00.000Z" }],
  },
});

type Tab = {
  host: string;
  href: string;
  bodyText?: string;
  /** The page's markup, where the account home shows each case's receipt number. */
  html?: string;
  /** What the case service answers when asked for the list, if it answers at all. */
  list?: unknown;
  /** Receipts this account can read. Defaults to `MINE` alone. */
  readable?: string[];
  /** Responses that are not cases, by receipt. */
  bodies?: Record<string, unknown>;
  /** my.uscis.gov's storage, kept between runs in the same browser. */
  storage?: Map<string, string>;
};

/** Runs a generated script as the browser would, in a signed-in tab. */
async function run(script: string, tab: Tab, extras: { completion?: (value: string) => void; noCompression?: boolean } = {}) {
  const alerts: string[] = [];
  const posted: string[] = [];
  const read: string[] = [];
  const readable = tab.readable ?? [MINE];
  const fetchStub = async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      posted.push(url);
      return new Response(null);
    }
    if (url === "/account/case-service/api/cases") {
      return tab.list === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(tab.list), { status: 200 });
    }
    const receipt = url.split("/").pop()!;
    read.push(receipt);
    if (tab.bodies?.[receipt] !== undefined) return new Response(JSON.stringify(tab.bodies[receipt]), { status: 200 });
    if (readable.includes(receipt)) return new Response(JSON.stringify(caseBody(receipt)), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const location = { host: tab.host, href: tab.href };
  const document = { body: { innerText: tab.bodyText ?? "" }, documentElement: { innerHTML: tab.html ?? "" } };
  const storage = tab.storage ?? new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  };
  const body = script.replace(/^javascript:/, "");
  await new Function("location", "fetch", "alert", "CompressionStream", "document", "completion", "localStorage", `return ${body}`)(
    location,
    fetchStub,
    (message: string) => alerts.push(message),
    extras.noCompression ? undefined : CompressionStream,
    document,
    extras.completion ?? (() => undefined),
    localStorage,
  );
  return { location, alerts, posted, read };
}

const payloadOf = (href: string) => decodeHandoff(readHandoffFragment(new URL(href).hash)!);

const signedIn: Tab = { host: "my.uscis.gov", href: "https://my.uscis.gov/account/applicant" };

describe("fragment handoff", () => {
  it("carries_every_readable_case_back_in_the_fragment_and_posts_nothing", async () => {
    // Regression guarded: this is the whole privacy claim. If the script posted
    // anywhere, or the cases landed in the query string, the host would see them.
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [MINE, THEIRS], delivery: "fragment" });
    const { location, posted, alerts } = await run(script, signedIn);

    expect(posted).toEqual([]);
    expect(alerts).toEqual([]);
    const url = new URL(location.href);
    expect(url.origin + url.pathname).toBe(TRACKER);
    expect(url.search).toBe("");

    const payload = await decodeHandoff(readHandoffFragment(url.hash)!);
    expect(payload.cases).toEqual([caseBody(MINE)]);
    // The other account's case was refused by USCIS, which is expected, and counted.
    expect(payload).toMatchObject({ denied: 1, failed: 0, codes: "404" });
  });

  it("compresses_the_cases_so_the_address_stays_short", async () => {
    // A case response repeats its keys per event. Uncompressed, a household of
    // cases could approach a browser's URL limit; compressed it is nowhere near.
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [MINE], delivery: "fragment" });
    const { location } = await run(script, signedIn);

    const encoded = readHandoffFragment(new URL(location.href).hash)!;
    expect(encoded[0]).toBe("1");
    expect(encoded.length).toBeLessThan(JSON.stringify(caseBody(MINE)).length / 2);
  });

  it("still_hands_over_on_a_browser_without_compression", async () => {
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [MINE], delivery: "fragment" });
    const { location } = await run(script, signedIn, { noCompression: true });

    const encoded = readHandoffFragment(new URL(location.href).hash)!;
    expect(encoded[0]).toBe("0");
    expect((await decodeHandoff(encoded)).cases).toEqual([caseBody(MINE)]);
  });

  it("survives_being_stored_as_a_javascript_url", () => {
    // Regression guarded: a bookmarklet is a URL. A browser parses it, then
    // percent-decodes it before running it, so a literal "#" would start the
    // URL's fragment and a "%" could be decoded into something else.
    for (const script of [
      buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [MINE], delivery: "fragment" }),
      buildRefreshBookmarklet({ trackerOrigin: "https://uscis.example.com", receipts: [MINE] }),
      buildImportFallbackBookmarklet(TRACKER, "fragment"),
    ]) {
      expect(script).not.toContain("#");
      expect(script).not.toContain("%");
      expect(decodeURIComponent(new URL(script).href)).toBe(script);
    }
  });

  it("falls_back_to_the_raw_case_page_when_nothing_was_readable", async () => {
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [THEIRS], delivery: "fragment" });
    const { location } = await run(script, signedIn);

    expect(location.href).toBe(`/account/case-service/api/cases/${THEIRS}`);
  });

  it("imports_the_raw_page_through_the_fragment_too", async () => {
    const script = buildImportFallbackBookmarklet(TRACKER, "fragment");
    const { location, posted } = await run(script, { ...signedIn, bodyText: JSON.stringify(caseBody(MINE)) });

    expect(posted).toEqual([]);
    const payload = await decodeHandoff(readHandoffFragment(new URL(location.href).hash)!);
    expect(payload.cases).toEqual([caseBody(MINE)]);
  });

  it("gives_the_shortcut_an_address_to_open_on_every_exit_path", async () => {
    // The Shortcut's next action is "Open URLs". Handing it prose, as the
    // self-hosted script's report does, would make that action fail.
    const script = buildShortcutScript({ trackerOrigin: TRACKER, receipts: [MINE, THEIRS], delivery: "fragment" });

    const results: string[] = [];
    await run(script, signedIn, { completion: (value) => results.push(value) });
    await run(script, { host: "example.com", href: "https://example.com/" }, { completion: (value) => results.push(value) });

    expect(results).toHaveLength(2);
    const [read, wrongSite] = await Promise.all(results.map((value) => decodeHandoff(readHandoffFragment(new URL(value).hash)!)));
    expect(read.cases).toEqual([caseBody(MINE)]);
    expect(wrongSite).toMatchObject({ cases: [], note: "wrong-site" });
  });

  it("leaves_the_self_hosted_scripts_posting_to_the_api", async () => {
    const script = buildRefreshBookmarklet({ trackerOrigin: "https://uscis.example.com", receipts: [MINE] });
    const { location, posted } = await run(script, signedIn);

    expect(posted).toEqual(["https://uscis.example.com/api/snapshots/import"]);
    // Nothing the server could not place, so nothing rides in the fragment.
    expect(location.href).toBe("https://uscis.example.com/?sent=1&denied=0&failed=0");
  });
});

describe("finding the account's cases", () => {
  const NEW = "IOE9912345777";
  const accountHome = (...receipts: string[]) => receipts.map((receipt) => `<a href="/account/case/${receipt}">Receipt # ${receipt}</a>`).join("");

  it("brings_back_the_cases_listed_on_the_page_when_nothing_is_tracked", async () => {
    // Regression guarded: the whole of onboarding. A new user saves the bookmark
    // with no receipts in it; if its first run came back empty they would be left
    // typing receipt numbers, which is what this replaced.
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [], delivery: "fragment" });
    const { location } = await run(script, { ...signedIn, html: accountHome(MINE, NEW), readable: [MINE, NEW] });

    const payload = await payloadOf(location.href);
    expect(payload.cases).toEqual([caseBody(MINE), caseBody(NEW)]);
    expect(payload).toMatchObject({ denied: 0, failed: 0, codes: "" });
  });

  it("says_nothing_about_receipt_shaped_text_that_is_not_a_case", async () => {
    // A page is full of identifiers. One that happens to look like a receipt is
    // read, refused, and must not show up as "belongs to the other account", and
    // one that is only part of a longer identifier must not be read at all.
    const html = `${accountHome(MINE)}<div id="ABC1234567890">x</div><img src="/img/XYZ12345678901234.png">`;
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [], delivery: "fragment" });
    const { location, read } = await run(script, { ...signedIn, html });

    expect(read).toEqual([MINE, "ABC1234567890"]);
    const payload = await payloadOf(location.href);
    expect(payload.cases).toEqual([caseBody(MINE)]);
    expect(payload).toMatchObject({ denied: 0, failed: 0, codes: "" });
  });

  it("drops_a_candidate_that_answers_without_case_data", async () => {
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [], delivery: "fragment" });
    const { location } = await run(script, { ...signedIn, html: accountHome(MINE, NEW), bodies: { [NEW]: { data: null, error: "nope" } } });

    expect((await payloadOf(location.href)).cases).toEqual([caseBody(MINE)]);
  });

  it("reads_what_the_case_service_lists_from_a_page_that_shows_no_cases", async () => {
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [], delivery: "fragment" });
    const { location } = await run(script, { ...signedIn, list: { data: [{ receiptNumber: MINE }] } });

    expect((await payloadOf(location.href)).cases).toEqual([caseBody(MINE)]);
  });

  it("stops_at_a_bounded_number_of_candidates", async () => {
    // A page of receipt-shaped noise must not turn one tap into hundreds of reads.
    const noise = Array.from({ length: 200 }, (_, i) => `ZZZ${String(i).padStart(10, "0")}`).join(" ");
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [MINE], delivery: "fragment" });
    const { read } = await run(script, { ...signedIn, html: noise });

    expect(read).toHaveLength(26);
  });

  it("remembers_what_it_read_so_a_bookmark_saved_on_day_one_keeps_working", async () => {
    // Regression guarded: the bookmark a new user saves has no receipts in it. If
    // it could only find cases on the page, running it from any other myUSCIS page
    // would refresh nothing and say so, or worse refresh one case and look done.
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [], delivery: "fragment" });
    const storage = new Map<string, string>();
    await run(script, { ...signedIn, html: accountHome(MINE), storage });

    const { location } = await run(script, { ...signedIn, href: "https://my.uscis.gov/account/profile", storage });

    expect((await payloadOf(location.href)).cases).toEqual([caseBody(MINE)]);
  });

  it("counts_a_remembered_case_from_the_other_account_as_theirs", async () => {
    // Both accounts are used in one browser, so its memory holds both people's
    // receipts, exactly as a bookmark with every receipt in it does.
    const script = buildRefreshBookmarklet({ trackerOrigin: TRACKER, receipts: [], delivery: "fragment" });
    const storage = new Map([["uscisTrackerReceipts", JSON.stringify([MINE, THEIRS])]]);
    const { location } = await run(script, { ...signedIn, storage });

    expect(await payloadOf(location.href)).toMatchObject({ cases: [caseBody(MINE)], denied: 1, codes: "404" });
  });

  it("self_hosted_posts_what_the_server_can_place_and_carries_the_rest_back", async () => {
    // The server refuses a receipt it has never seen unless told whose it is. A
    // blind post of a new case would be dropped, so it goes to the tracker instead.
    const script = buildRefreshBookmarklet({ trackerOrigin: "https://uscis.example.com", receipts: [MINE] });
    const { location, posted } = await run(script, { ...signedIn, html: accountHome(MINE, NEW), readable: [MINE, NEW] });

    expect(posted).toHaveLength(1);
    const url = new URL(location.href);
    expect(parseRefreshHandoff(url.search)).toEqual({ sent: 1, denied: 0, failed: 0, codes: "" });
    expect((await payloadOf(location.href)).cases).toEqual([caseBody(NEW)]);
  });
});

describe("decodeHandoff", () => {
  const encode = new Function(`${ENCODER_JS}return E;`)() as (value: unknown) => Promise<string>;

  it("rejects_a_fragment_that_is_not_a_handoff", async () => {
    await expect(decodeHandoff("1not-base64!")).rejects.toThrow();
    await expect(decodeHandoff(await encode({ hello: "world" }))).rejects.toThrow("Unknown handoff shape.");
  });

  it("reads_a_fragment_whose_base64_was_percent_encoded_in_transit", async () => {
    const encoded = await encode({ v: 1, cases: [caseBody(MINE)], denied: 0, failed: 0, codes: "" });
    const escaped = encoded[0] + encodeURIComponent(encoded.slice(1));

    expect((await decodeHandoff(escaped)).cases).toEqual([caseBody(MINE)]);
  });

  it("only_treats_an_import_fragment_as_a_handoff", () => {
    expect(readHandoffFragment("")).toBeNull();
    expect(readHandoffFragment("#import=")).toBeNull();
    expect(readHandoffFragment("#section")).toBeNull();
    expect(readHandoffFragment("#import=1abc")).toBe("1abc");
  });
});

describe("storeHandoff", () => {
  const NEW = "IOE9912345777";
  const payload = (...receipts: string[]) => ({ v: 1 as const, cases: receipts.map(caseBody), denied: 0, failed: 0, codes: "" });
  const tracker = (over: Partial<TrackerState> = {}): TrackerState => ({ tracked: new Set([MINE]), ignored: new Set(), soleOwner: null, ...over });

  function recorder() {
    const stored: { receipt: string; personId?: string }[] = [];
    const importSnapshot = async ({ raw, personId }: { raw: unknown; personId?: string }) => {
      stored.push({ receipt: (raw as ReturnType<typeof caseBody>).data.receiptNumber, personId });
    };
    return { stored, importSnapshot };
  }

  it("adds_a_new_case_for_the_only_person_without_asking", async () => {
    // With one person there is nobody else a case could belong to. This is the
    // first run for most people: add yourself, tap the bookmark, see your cases.
    const { stored, importSnapshot } = recorder();
    const { handoff, found } = await storeHandoff(payload(MINE, NEW), tracker({ soleOwner: { id: "p1", name: "Alex" } }), importSnapshot);

    expect(stored).toEqual([
      { receipt: MINE, personId: undefined },
      { receipt: NEW, personId: "p1" },
    ]);
    expect(found).toEqual([]);
    expect(describeRefresh(handoff, { newChanges: 0, lastMovementIso: null })).toEqual({
      tone: "info",
      message: "2 cases read. 1 is new and was added for Alex.",
    });
  });

  it("asks_whose_a_new_case_is_when_more_than_one_person_is_tracked", async () => {
    // Regression guarded: the script cannot tell whose account it ran in. Guessing
    // would file one person's green card case under the other.
    const { stored, importSnapshot } = recorder();
    const { handoff, found } = await storeHandoff(payload(MINE, NEW), tracker(), importSnapshot);

    expect(stored).toEqual([{ receipt: MINE, personId: undefined }]);
    expect(found).toEqual([{ raw: caseBody(NEW), receiptNumber: NEW, formType: "I-485" }]);
    expect(describeRefresh(handoff).message).toBe("1 case read. 1 new case found. Choose who it belongs to.");
  });

  it("does_not_call_a_run_that_only_found_new_cases_a_failure", async () => {
    const { importSnapshot } = recorder();
    const { handoff } = await storeHandoff(payload(MINE, NEW), tracker({ tracked: new Set() }), importSnapshot);

    expect(describeRefresh(handoff)).toEqual({ tone: "info", message: "2 new cases found. Choose who they belong to." });
  });

  it("never_brings_back_a_case_the_user_deleted", async () => {
    // Regression guarded: the script finds every case on the account, so without
    // this a deleted case would be re-added by the very next refresh.
    const { stored, importSnapshot } = recorder();
    const state = tracker({ ignored: new Set([NEW]), soleOwner: { id: "p1", name: "Alex" } });
    const { handoff, found } = await storeHandoff(payload(MINE, NEW), state, importSnapshot);

    expect(stored).toEqual([{ receipt: MINE, personId: undefined }]);
    expect(found).toEqual([]);
    expect(handoff).toMatchObject({ sent: 1, added: 0, found: 0, unstored: 0 });
  });

  it("keeps_storing_after_one_response_cannot_be_stored_and_says_so", async () => {
    // One bad response must not cost the other cases, and the report must not
    // call the run clean.
    const { stored, importSnapshot } = recorder();
    const cases = [caseBody(MINE), { data: { receiptNumber: "not-a-receipt" } }, caseBody(NEW)];
    const { handoff } = await storeHandoff({ ...payload(), cases }, tracker({ tracked: new Set([MINE, NEW]) }), importSnapshot);

    expect(stored.map((item) => item.receipt)).toEqual([MINE, NEW]);
    expect(describeRefresh(handoff, { newChanges: 0, lastMovementIso: null })).toEqual({
      tone: "error",
      message: "2 cases read. 1 came back in a form the tracker could not store.",
    });
  });

  it("adds_up_what_was_posted_and_what_came_back_in_the_fragment", () => {
    const posted = { sent: 2, denied: 1, failed: 0, codes: "404" };
    const stored = { sent: 1, denied: 0, failed: 0, codes: "", added: 1, addedFor: "Alex", found: 0, unstored: 0 };

    expect(describeRefresh(combineHandoffs(posted, stored)!).message).toBe(
      "3 cases read. 1 is new and was added for Alex. 1 belongs to the other USCIS account — sign in as them and refresh again.",
    );
    expect(combineHandoffs(posted, null)).toBe(posted);
    expect(combineHandoffs(null, null)).toBeNull();
  });
});

describe("routes under a base path", () => {
  it("resolves_and_builds_paths_wherever_the_app_is_served", () => {
    // GitHub Pages serves a project site under /<repo>/, not at the root.
    expect(routeFromPath("/uscis-tracker/", "/uscis-tracker/")).toBe("home");
    expect(routeFromPath("/uscis-tracker/connection", "/uscis-tracker/")).toBe("connection");
    expect(routeFromPath("/uscis-tracker/connection/", "/uscis-tracker/")).toBe("connection");
    expect(routeHref("connection", "/uscis-tracker/")).toBe("/uscis-tracker/connection");

    expect(routeFromPath("/", "/")).toBe("home");
    expect(routeFromPath("/connection", "/")).toBe("connection");
    expect(routeFromPath("/nowhere", "/")).toBe("home");
    expect(routeHref("home", "/")).toBe("/");
  });
});
