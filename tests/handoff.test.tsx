import { describe, expect, it } from "vitest";
import { buildImportFallbackBookmarklet, buildRefreshBookmarklet, buildShortcutScript } from "../src/lib/bookmarklet.js";
import { ENCODER_JS, decodeHandoff, readHandoffFragment } from "../src/lib/handoff.js";
import { describeRefresh, storeHandoff } from "../src/lib/refreshHandoff.js";
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

type Tab = { host: string; href: string; bodyText?: string };

/** Runs a generated script as the browser would, in a tab where only `MINE` is readable. */
async function run(script: string, tab: Tab, extras: { completion?: (value: string) => void; noCompression?: boolean } = {}) {
  const alerts: string[] = [];
  const posted: string[] = [];
  const fetchStub = async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      posted.push(url);
      return new Response(null);
    }
    if (url.endsWith(MINE)) return new Response(JSON.stringify(caseBody(MINE)), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const location = { host: tab.host, href: tab.href };
  const document = { body: { innerText: tab.bodyText ?? "" } };
  const body = script.replace(/^javascript:/, "");
  await new Function("location", "fetch", "alert", "CompressionStream", "document", "completion", `return ${body}`)(
    location,
    fetchStub,
    (message: string) => alerts.push(message),
    extras.noCompression ? undefined : CompressionStream,
    document,
    extras.completion ?? (() => undefined),
  );
  return { location, alerts, posted };
}

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

  it("leaves_the_self_hosted_scripts_posting_to_the_api", () => {
    const script = buildRefreshBookmarklet({ trackerOrigin: "https://uscis.example.com", receipts: [MINE] });

    expect(script).toContain(`"/api/snapshots/import"`);
    expect(script).not.toContain("CompressionStream");
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
  it("keeps_storing_after_one_case_is_refused_and_says_so", async () => {
    // A case deleted since the bookmark was saved is still read from USCIS. It
    // must not cost the other cases, and the report must not call the run clean.
    const stored: unknown[] = [];
    const handoff = await storeHandoff({ v: 1, cases: ["a", "gone", "b"], denied: 0, failed: 0, codes: "" }, async ({ raw }) => {
      if (raw === "gone") throw new Error("not tracked");
      stored.push(raw);
    });

    expect(stored).toEqual(["a", "b"]);
    expect(handoff).toEqual({ sent: 2, denied: 0, failed: 0, codes: "", unstored: 1 });
    expect(describeRefresh(handoff, { newChanges: 0, lastMovementIso: null })).toEqual({
      tone: "error",
      message: "2 cases read. 1 is not tracked here any more. Add the case, then refresh again.",
    });
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
