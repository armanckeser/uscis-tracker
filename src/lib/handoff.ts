// How case data gets from a signed-in my.uscis.gov tab to the browser-only
// tracker without a server in between.
//
// The refresh script reads the cases, packs them into the URL fragment and
// navigates to the tracker. A fragment is the one part of a URL a browser never
// sends: the static host is asked for the page and nothing else. The tracker
// reads the fragment, removes it from the address bar, and stores the cases in
// IndexedDB.
//
// The alternatives do not work. An iframe of the tracker inside my.uscis.gov
// gets partitioned storage, not the tracker's own. `window.name` is cleared on a
// cross-site navigation. A POST needs something listening.

export const HANDOFF_PARAM = "import";

export type HandoffPayload = {
  v: 1;
  /** Raw USCIS case responses, exactly as read. */
  cases: unknown[];
  /** Refused because they belong to another USCIS account. */
  denied: number;
  /** Refused or unreadable for some other reason. */
  failed: number;
  /** HTTP statuses seen on the refusals, joined with "-". */
  codes: string;
  /** Set when the script was run somewhere other than my.uscis.gov. */
  note?: "wrong-site";
};

/**
 * Source for `E`, an async function turning a value into fragment-safe text.
 * Embedded in the refresh scripts, so it runs on my.uscis.gov, not here.
 *
 * The text is one marker character, then base64: "1" for deflate-compressed
 * JSON, "0" for plain JSON on a browser without CompressionStream. A case
 * response repeats the same keys for every event, so it compresses to a fraction
 * of its size, which keeps the URL far below any browser's length limit.
 *
 * No regex literals, no "#" and no "%": the script travels as a `javascript:`
 * URL, where a browser may escape or unescape any of those.
 */
export const ENCODER_JS =
  `const E=async o=>{` +
  `let b=new TextEncoder().encode(JSON.stringify(o)),z="0";` +
  `if(typeof CompressionStream!="undefined"){b=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());z="1";}` +
  `let s="";for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode.apply(null,b.subarray(i,i+8192));` +
  `return z+btoa(s);};`;

/** The encoded payload in a URL fragment, or null when this was not a handoff. */
export function readHandoffFragment(hash: string): string | null {
  const prefix = `#${HANDOFF_PARAM}=`;
  return hash.startsWith(prefix) && hash.length > prefix.length ? hash.slice(prefix.length) : null;
}

function isPayload(value: unknown): value is HandoffPayload {
  const payload = value as Partial<HandoffPayload> | null;
  return Boolean(payload) && typeof payload === "object" && payload!.v === 1 && Array.isArray(payload!.cases);
}

export async function decodeHandoff(encoded: string): Promise<HandoffPayload> {
  const marker = encoded[0];
  // A browser may percent-encode "+", "/" or "=" in a fragment on the way through.
  const binary = atob(decodeURIComponent(encoded.slice(1)));
  let bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (marker === "1") {
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    bytes = new Uint8Array(await new Response(inflated).arrayBuffer());
  } else if (marker !== "0") {
    throw new Error("Unknown handoff encoding.");
  }
  const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isPayload(payload)) throw new Error("Unknown handoff shape.");
  return {
    v: 1,
    cases: payload.cases,
    denied: Number(payload.denied) || 0,
    failed: Number(payload.failed) || 0,
    codes: typeof payload.codes === "string" ? payload.codes : "",
    note: payload.note === "wrong-site" ? "wrong-site" : undefined,
  };
}
