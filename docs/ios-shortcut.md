# Refreshing from an iPhone

The refresh has to run inside a browser already signed in to myUSCIS — see
[acquisition-research.md](acquisition-research.md) for why nothing can do it
unattended. On a phone there are two ways to trigger that, and a fallback.

The app generates the exact script and bookmark for your tracked cases on the
**Refresh** screen. Copy them from there rather than from this file, so the
receipt list stays current.

## Option A — Shortcut from the share sheet (recommended)

A Shortcut is launched by tapping Share, which is a normal gesture. A bookmarklet
has to be launched by typing its name into the address bar.

1. **Settings → Shortcuts → Advanced → Allow Running Scripts** — on.
2. New shortcut → add **Run JavaScript on Webpage** → replace its contents with
   the script from the Refresh screen.
3. In the shortcut's details: **Show in Share Sheet** on, accepting **Safari web
   pages**.
4. Sign in to myUSCIS, tap **Share**, pick the shortcut. Approve the privacy
   prompt the first time.

It reports something like `2 sent, 2 not this account. Open the tracker to see
what changed.` Cases belonging to the other person's account are denied by USCIS,
which is expected — run the same shortcut in that account's session too.

### Why it is shaped that way

Both of these are requirements of the action, not style choices:

- **`completion(...)` must be called.** The action does not return the value of
  the last expression. If `completion` is never called the shortcut hangs until
  Safari kills it. Every exit path in the script calls it, including the
  wrong-site guard.
- **The work is wrapped in an async IIFE.** Top-level `await` is not reliable in
  that action, so `completion` is called from inside the async function once the
  fetches resolve.

The script runs in the page's origin context, which is what makes it work at all:
a same-origin `fetch(..., {credentials:"include"})` carries the HttpOnly session
cookie automatically. The script never reads the cookie and the session never
leaves the phone.

It reports how many responses it **delivered**, not how many were imported. The
POST to the tracker is a cross-origin `no-cors` request so the reverse proxy's
CORS rewrite cannot block it, which makes the response opaque — the script cannot
see what the server did. The tracker itself reports that.

### If it does not work

Verify on your own phone before assuming the app is broken. Known limits:

- **Share sheet only.** There is no way to run it against the frontmost tab from
  the Home Screen, a widget, or Siri. iOS has no "active tab" input outside the
  share sheet.
- **It hangs instead of reporting** → the script is not reaching a
  `completion(...)` call. Re-copy it from the Refresh screen.
- **The action is missing** → "Allow Running Scripts" is off, or the shortcut is
  not set to accept Safari web pages.

Some details of Apple's behaviour here could not be confirmed against a primary
source (the exact timeout message, whether the privacy prompt is once-per-domain
or every run, and a reported iOS 18.4 slowdown on scripts containing comments —
the generated script has none). Treat those as verify-on-device.

### In the browser-only tracker

There is no server for the script to post to, so it works differently at the end:
the script's result is the tracker's address with the cases packed into the URL
fragment, and a second action opens it.

- After **Run JavaScript on Webpage**, add an **Open URLs** action. It receives the
  script's result and opens the tracker in Safari, which stores the cases.
- Every exit path returns an address, including the wrong-site guard, so that
  action is never handed a sentence it cannot open.
- Use the tracker in Safari, not from the Home Screen. A Home Screen app has its
  own storage and would never see what the Shortcut opened in Safari.

This flow is built from the action's documented behaviour (a script's
`completion` value is passed to the next action) and has not been run on a
device yet. Treat it as verify-on-device.

## Option B — bookmarklet

Save the **Refresh cases** bookmark from the Refresh screen as a bookmark, then
launch it by typing its name in the address bar while on a signed-in myUSCIS page.
Same mechanism; worse trigger. It ends by navigating back to the tracker with
delivery counts.

## Fallback — import the raw page

On iPhone a background read is sometimes refused even when you are signed in. Both
Option A and Option B handle this by opening the case data as a plain page instead
(a top-level GET carries the session where a background fetch did not). Tap the
**Import this page** bookmark there to finish. Save it once, alongside the other.
