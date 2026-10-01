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
//
// Nobody should have to type a receipt number. The scripts look for the
// account's cases themselves (see discoverJs), so a bookmark saved before any
// case was tracked brings the cases back on its first run.

import { ENCODER_JS, HANDOFF_PARAM } from "./handoff.js";

const USCIS_HOST_SUFFIX = "my.uscis.gov";
const CASE_API_PATH = "/account/case-service/api/cases/";
const CASE_LIST_PATH = "/account/case-service/api/cases";
const IMPORT_PATH = "/api/snapshots/import";
/** Where a script keeps the receipts it has read, in my.uscis.gov's own storage. */
const MEMORY_KEY = "uscisTrackerReceipts";
/** Receipt-shaped text is not always a receipt, so a page can only add this many reads to a run. */
const MAX_DISCOVERED = 25;

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
 * Works out which receipts to read, leaving them in `K` with the first `W` being
 * ones already known. Expects `R` (the receipts tracked when the script was made).
 *
 * Known receipts come from two places: `R`, and the script's own memory of what
 * it has read before in this browser. The memory is what keeps a bookmark saved
 * on day one from going stale: every case it has ever brought back is read again,
 * whichever page it is run on.
 *
 * New ones are found on the page. The account home lists every case with its
 * receipt number, so that page's own markup is searched, along with the address
 * and whatever the case service answers when asked for the list. Nothing found
 * this way is trusted: each candidate is read like any other receipt, and one
 * that is not a case of this account is dropped without a word.
 *
 * No backslashes in the pattern, so it survives being stored as a URL.
 */
function discoverJs(): string {
  return (
    `const K=R.slice(),M=${jsString(MEMORY_KEY)};` +
    `try{for(const r of JSON.parse(localStorage.getItem(M)||"[]"))if(K.indexOf(r)<0)K.push(r);}catch(e){}` +
    `const W=K.length,X=new RegExp("(?:^|[^A-Za-z0-9])([A-Z]{3}[0-9]{10})(?![A-Za-z0-9])","g"),` +
    `A=t=>{let m;X.lastIndex=0;while((m=X.exec(t))&&K.length<W+${MAX_DISCOVERED})if(K.indexOf(m[1])<0)K.push(m[1]);};` +
    `try{A(location.href+" "+document.documentElement.innerHTML);}catch(e){}` +
    `try{const l=await fetch(${jsString(CASE_LIST_PATH)},{credentials:"include",headers:{Accept:"application/json"}});if(l.ok)A(await l.text());}catch(e){}`
  );
}

/**
 * The read loop both triggers share, defined once.
 *
 * It expects `T` (tracker origin) and `R` (receipts) already in scope and leaves
 * behind `sent`, `denied`, `failed`, `C` (the distinct refusal statuses), `G`
 * (the receipts that were read) and `D` (the responses the tracker has to store
 * itself). The bookmarklet and the Shortcut used to carry their own copies of
 * this, and they drifted: a fix to the refusal classification landed in one and
 * not the other.
 *
 * A receipt from the other person's account is refused, not broken — a myUSCIS
 * session can only read its own cases, and USCIS scopes by account, so 404 means
 * "not yours" exactly as much as 401/403 does. Counting 404 as a failure is what
 * made a working two-account refresh report "2 cases could not be read from USCIS.
 * Sign in again and retry." The statuses are carried back so an unexpected one is
 * diagnosable instead of guessed at.
 *
 * Only a known receipt is counted when it is refused. A candidate found on the
 * page that turns out not to be a case is not a refusal of anything.
 *
 * The self-hosted script posts the receipts in `R`, which the server can place.
 * Anything else it read goes back in `D`: the server refuses a receipt it has
 * never seen unless it is told whose it is, and only the tracker can ask.
 */
function readAllCasesJs(delivery: Delivery, discover = true): string {
  const post = `await fetch(T+${jsString(IMPORT_PATH)},{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify({raw})});`;
  const deliver = delivery === "fragment" ? `D.push(raw);sent++;` : `if(i<R.length){${post}sent++;}else{D.push(raw);}`;
  return (
    (discover ? discoverJs() : `const K=R,W=K.length;`) +
    `let sent=0,denied=0,failed=0;const C=[],D=[],G=[];` +
    `for(let i=0;i<K.length;i++){const r=K[i],k=i<W;try{` +
    `const res=await fetch(${jsString(CASE_API_PATH)}+r,{credentials:"include",headers:{Accept:"application/json"}});` +
    `if(!res.ok){if(!k)continue;if(C.indexOf(res.status)<0)C.push(res.status);` +
    `if(res.status===401||res.status===403||res.status===404){denied++;}else{failed++;}continue;}` +
    `const raw=await res.json();` +
    `if(!k&&!(raw&&raw.data))continue;` +
    deliver +
    `G.push(r);` +
    `}catch(e){if(k){failed++;if(C.indexOf("err")<0)C.push("err");}}}` +
    (discover ? `try{localStorage.setItem(M,JSON.stringify(K.filter((r,i)=>i<W||G.indexOf(r)>=0).slice(-60)));}catch(e){}` : ``)
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
 * Builds the single "Refresh cases" bookmarklet.
 *
 * There is deliberately one bookmark rather than one per person. The import
 * endpoint derives a case's owner from the receipt number in the response, so
 * the script carries no identity — which means it does not have to be told whose
 * session it is running in. A receipt belonging to the other person's account
 * simply fails its fetch and is counted, so the same bookmark works signed in as
 * either of them.
 *
 * It works with no receipts at all: that is the bookmark a new user saves, and
 * its first run is what finds their cases.
 */
export function buildRefreshBookmarklet(input: RefreshInput): string {
  const trackerOrigin = jsString(input.trackerOrigin);
  const receipts = JSON.stringify([...input.receipts]);

  const delivery = input.delivery ?? "post";
  // The self-hosted script has already posted what the server could place. What
  // it could not rides along in the fragment, behind the counts.
  const handBack =
    delivery === "fragment"
      ? `location.href=${fragmentUrlJs(READ_PAYLOAD_JS)};`
      : `location.href=T+"/?sent="+sent+"&denied="+denied+"&failed="+failed+(C.length?"&codes="+C.join("-"):"")` +
        `+(D.length?String.fromCharCode(35)+${jsString(HANDOFF_PARAM + "=")}+await E({v:1,cases:D,denied:0,failed:0,codes:""}):"");`;

  return (
    `javascript:(async()=>{` +
    `const T=${trackerOrigin},R=${receipts};` +
    `if(!location.host.endsWith(${jsString(USCIS_HOST_SUFFIX)})){alert("Open my.uscis.gov (signed in) first, then tap this.");return;}` +
    ENCODER_JS +
    readAllCasesJs(delivery) +
    // Every known case refused and nothing read means this browser is not signed
    // in. Send the tab to a raw case page: a top-level GET carries the session
    // even where a background fetch did not, and "Import this page" finishes the job.
    `if(G.length===0&&denied>0){location.href=${jsString(CASE_API_PATH)}+K[0];return;}` +
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
    // This script's result is a sentence, not an address, so a case it found could
    // not be handed to the tracker. It reads the tracked receipts and nothing else.
    readAllCasesJs("post", false) +
    `completion(sent+" read, "+denied+" not this account"+(failed?", "+failed+" failed ("+C.join("-")+")":"")+". Open the tracker to see what changed.");` +
    `})();`
  );
}
