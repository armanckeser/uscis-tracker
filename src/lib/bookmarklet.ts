// Generators for the refresh bookmarklets. A bookmarklet run on a logged-in
// my.uscis.gov page can do a same-origin authenticated fetch (the browser
// attaches the HttpOnly session) and POST the result to this tracker's import
// endpoint, so the session never has to leave the device. It is the only
// mechanism that can see a silent update: see docs/acquisition-research.md.
//
// Interpolated values are embedded with JSON.stringify, which emits a correctly
// escaped JS string literal. That keeps a receipt number or origin from breaking
// out of the `javascript:` string regardless of its contents.
//
// The import POST is sent as a CORS "simple request" (Content-Type text/plain,
// mode no-cors): no preflight, and it is never blocked by the reverse proxy
// rewriting Access-Control-Allow-Origin. The server's c.req.json() parses the
// body by content regardless of Content-Type.
//
// The response is therefore opaque and these scripts can never know what the
// server did with a snapshot. Rather than guess, they finish by navigating to
// the tracker, which is same-origin with its own API and reports the truth.
// Navigation is also the cheaper interaction on a phone: no alert to dismiss,
// and it lands on the screen the user was going to open next anyway.
//
// The browser-only build has no import endpoint to POST to. There the same
// scripts pack what they read into the URL fragment and navigate to the tracker,
// which stores it itself (delivery "fragment", see handoff.ts). Nothing is sent
// anywhere: a fragment never leaves the browser.

import { ENCODER_JS, HANDOFF_PARAM } from "./handoff.js";

const USCIS_HOST_SUFFIX = "my.uscis.gov";
const CASE_API_PATH = "/account/case-service/api/cases/";
const IMPORT_PATH = "/api/snapshots/import";

export type Delivery = "post" | "fragment";

export type RefreshInput = {
  /** "post": the tracker's origin. "fragment": the full address of the app, ending in "/". */
  trackerOrigin: string;
  receipts: readonly string[];
  /** How a read case reaches the tracker. Defaults to "post", the self-hosted API. */
  delivery?: Delivery;
};

function jsString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The read loop both triggers share, defined once.
 *
 * It expects `T` (tracker origin) and `R` (receipts) already in scope and leaves
 * behind `sent`, `denied`, `failed`, and `C` (the distinct refusal statuses). The
 * bookmarklet and the Shortcut used to carry their own copies of this, and they
 * drifted: a fix to the refusal classification landed in one and not the other.
 *
 * A receipt from the other person's account is refused, not broken — a myUSCIS
 * session can only read its own cases, and USCIS scopes by account, so 404 means
 * "not yours" exactly as much as 401/403 does. Counting 404 as a failure is what
 * made a working two-account refresh report "2 cases could not be read from USCIS.
 * Sign in again and retry." The statuses are carried back so an unexpected one is
 * diagnosable instead of guessed at.
 */
function readAllCasesJs(delivery: Delivery): string {
  const deliver =
    delivery === "fragment"
      ? `D.push(raw);`
      : `await fetch(T+${jsString(IMPORT_PATH)},{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify({raw})});`;
  return (
    `let sent=0,denied=0,failed=0;const C=[];` +
    (delivery === "fragment" ? `const D=[];` : ``) +
    `for(const r of R){try{` +
    `const res=await fetch(${jsString(CASE_API_PATH)}+r,{credentials:"include",headers:{Accept:"application/json"}});` +
    `if(!res.ok){if(C.indexOf(res.status)<0)C.push(res.status);` +
    `if(res.status===401||res.status===403||res.status===404){denied++;}else{failed++;}continue;}` +
    `const raw=await res.json();` +
    deliver +
    `sent++;` +
    `}catch(e){failed++;if(C.indexOf("err")<0)C.push("err");}}`
  );
}

/**
 * An expression for the tracker address carrying `payload` in its fragment.
 * Expects `T` and `E` in scope. The "#" is built from its character code because
 * the script is itself a URL, and a literal one would start that URL's fragment.
 */
function fragmentUrlJs(payload: string): string {
  return `T+String.fromCharCode(35)+${jsString(HANDOFF_PARAM + "=")}+await E(${payload})`;
}

const READ_PAYLOAD_JS = `{v:1,cases:D,denied,failed,codes:C.join("-")}`;

/**
 * Builds the single "Refresh cases" bookmarklet, covering every tracked receipt.
 *
 * There is deliberately one bookmark rather than one per person. The import
 * endpoint derives a case's owner from the receipt number in the response, so
 * the script carries no identity — which means it does not have to be told whose
 * session it is running in. A receipt belonging to the other person's account
 * simply fails its fetch and is counted, so the same bookmark works signed in as
 * either of them.
 *
 * With no receipts it returns a bookmarklet that says so rather than looping over
 * nothing.
 */
export function buildRefreshBookmarklet(input: RefreshInput): string {
  const trackerOrigin = jsString(input.trackerOrigin);
  const receipts = JSON.stringify([...input.receipts]);

  if (input.receipts.length === 0) {
    return `javascript:(function(){alert("USCIS Tracker: no cases are being tracked yet.");})();`;
  }

  const delivery = input.delivery ?? "post";
  const handBack =
    delivery === "fragment"
      ? `location.href=${fragmentUrlJs(READ_PAYLOAD_JS)};`
      : `location.href=T+"/?sent="+sent+"&denied="+denied+"&failed="+failed+(C.length?"&codes="+C.join("-"):"");`;

  return (
    `javascript:(async()=>{` +
    `const T=${trackerOrigin},R=${receipts};` +
    `if(!location.host.endsWith(${jsString(USCIS_HOST_SUFFIX)})){alert("Open my.uscis.gov (signed in) first, then tap this.");return;}` +
    (delivery === "fragment" ? ENCODER_JS : ``) +
    readAllCasesJs(delivery) +
    // Nothing readable at all means this browser is not signed in. Send the tab to
    // a raw case page: a top-level GET carries the session even where a
    // background fetch did not, and "Import this page" finishes the job.
    `if(sent===0&&denied>0){location.href=${jsString(CASE_API_PATH)}+R[0];return;}` +
    handBack +
    `})();`
  );
}

/**
 * Builds the companion "Import this page" bookmarklet. Used after the refresh
 * bookmarklet navigates to a raw case JSON page on iOS: it parses the JSON the
 * page is showing and posts it. Carries no identity for the same reason.
 */
export function buildImportFallbackBookmarklet(trackerOrigin: string, delivery: Delivery = "post"): string {
  const origin = jsString(trackerOrigin);
  const deliver =
    delivery === "fragment"
      ? `location.href=${fragmentUrlJs(`{v:1,cases:[raw],denied:0,failed:0,codes:""}`)};`
      : `await fetch(T+${jsString(IMPORT_PATH)},{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify({raw})});` +
        `location.href=T+"/?sent=1";`;

  return (
    `javascript:(async()=>{` +
    `const T=${origin};` +
    (delivery === "fragment" ? ENCODER_JS : ``) +
    `try{` +
    `const raw=JSON.parse(document.body.innerText);` +
    deliver +
    `}catch(e){alert("Open a my.uscis.gov case JSON page first, then tap Import.");}` +
    `})();`
  );
}

/**
 * Builds the body of the "Run JavaScript on Webpage" action for an iOS Shortcut.
 *
 * Same mechanism as the bookmarklet -- it runs in the page's origin context, so a
 * same-origin credentialed fetch carries the HttpOnly session without the script
 * ever reading it -- but launched from the Safari share sheet, which is a real
 * gesture on a phone rather than typing a bookmark name into the address bar.
 *
 * Two hard requirements of that action, both verified:
 *  - `completion()` must be called explicitly. The action does not return the last
 *    expression, and never calling it hangs the shortcut until Safari kills it.
 *  - Top-level `await` is not reliable there, so the work is wrapped in an async
 *    IIFE and `completion()` is called inside it.
 *
 * The string passed to `completion()` is what Shortcuts shows, and it is
 * deliberately about delivery, not import: the POST is an opaque no-cors request
 * for the same CORS reason as the bookmarklet, so this script cannot know what the
 * server stored. The tracker reports that.
 */
export function buildShortcutScript(input: RefreshInput): string {
  const trackerOrigin = jsString(input.trackerOrigin);
  const receipts = JSON.stringify([...input.receipts]);

  // With no server to post to, the script's result is the tracker address with
  // the cases in its fragment, and the Shortcut's next action opens it. Every
  // exit path returns an address, so that action never receives prose.
  if (input.delivery === "fragment") {
    return (
      `(async()=>{` +
      `const T=${trackerOrigin},R=${receipts};` +
      ENCODER_JS +
      `if(!location.host.endsWith(${jsString(USCIS_HOST_SUFFIX)})){completion(${fragmentUrlJs(`{v:1,cases:[],denied:0,failed:0,codes:"",note:"wrong-site"}`)});return;}` +
      readAllCasesJs("fragment") +
      `completion(${fragmentUrlJs(READ_PAYLOAD_JS)});` +
      `})();`
    );
  }

  return (
    `(async()=>{` +
    `const T=${trackerOrigin},R=${receipts};` +
    `if(!location.host.endsWith(${jsString(USCIS_HOST_SUFFIX)})){completion("Open my.uscis.gov first, then share this page.");return;}` +
    readAllCasesJs("post") +
    `completion(sent+" read, "+denied+" not this account"+(failed?", "+failed+" failed ("+C.join("-")+")":"")+". Open the tracker to see what changed.");` +
    `})();`
  );
}
