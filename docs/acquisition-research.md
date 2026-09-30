# How to get USCIS case data (researched 2026-07-26)

Why autorefresh does not work, what the alternatives actually are, and what to
build. Confidence is marked per claim because most USCIS pages block automated
fetches, so several claims could not be confirmed against a primary source.

Confidence key: **[verified]** confirmed from a primary source this session ·
**[prior]** confirmed by earlier hands-on work on this tracker ·
**[secondary]** consistent across searches, no primary source ·
**[contested]** community lore, treat as unknown.

---

## The finding that settles it

**myUSCIS requires a fresh one-time code on every sign-in. There is no "trust
this device".** [secondary, corroborated] A server therefore cannot re-authenticate on its own. The
session cookie it holds is the only credential, and that cookie dies on a
~15–30 minute idle timeout (a Rails/Devise session cookie). [prior]

The poller runs every 30 minutes. Its interval is at or past the lifetime of the
only credential it has, and it cannot mint a new one. So the steady state is:
cookie dies → `401` → every case auto-pauses → nothing is observed again until a
human reconnects.

Autorefresh is not flaky. On this mechanism it cannot work.

Corroboration that this is the real constraint rather than bot-blocking: the
most active comparable open-source tracker (`jrdeng93/uscis-case-API-monitor`,
pushed 2026-07-23) [verified] drives Playwright, saves the session to disk, and
**reads the login OTP out of the macOS Messages database** to get through 2FA on
every re-auth. Someone went to that length because there is no other way in.

Also worth stating plainly: the account terms are written to prohibit using
third-party software to access the account, and violations name account
suspension. [secondary — the terms page itself returned 403 to an automated fetch, so this
is not a verbatim quote.] Every avenue below except the official API carries
some version of that risk; the user-initiated ones carry the least.

---

## What each avenue can actually do

### Authenticated `case-service` JSON — the only source that sees silent updates

`my.uscis.gov/account/case-service/api/cases/{receipt}`. Rich payload:
`updatedAtTimestamp`, `events[]`, `notices[]`, `closed`, `actionRequired`. [prior]

A silent update is a change to the backend record with no change to the
human-readable status and no notification. The field that moves is the
last-updated timestamp, sometimes with new `events[]` entries or boolean flag
toggles. [secondary + prior] The comparable tracker diffs exactly
`updatedAt` / `events` / `closed` / `actionRequired` [verified] — the same fields
this tracker already diffs.

**This is only visible on the authenticated endpoint.** [prior] Nothing else exposes it.

### Public `egov.uscis.gov` status check — not a fallback

Reportedly rebuilt as a Cloudflare-gated SPA; the old
`mycasestatus.do?appReceiptNum=` deep link no longer accepts a receipt via query
string and plain HTTP clients get a challenge page. [secondary] Independent of whether that
is exactly right, it only ever exposed the plain-English status, so **it cannot
see silent updates at all.** [prior]

Ruled out. It is both blockable and blind.

### Official developer.uscis.gov Case Status API — not obtainable, and thin

OAuth2 client credentials. Production access requires sustained sandbox traffic,
**Form G-1595**, and a live demo with USCIS. [prior + secondary] Returns roughly
`receiptNumber`, `formType`, `submittedDate`, `modifiedDate`, and the status
text. [secondary]

Two independent reasons to skip it: the gate is aimed at legal organisations, not
two people, and the payload is close to the public status plus a date — so even
if granted it is a weaker silent-update detector than what we already have.

### USCIS email / text status subscription — free, push, partial

Fires on a **visible status-text change**. It does not fire on a silent update.
[secondary] Sender addresses and SMS short codes circulate in the community but I could
not confirm any of them [contested] — do not write a parser against a specific
address until a real message is in hand.

Still worth having: it costs one setup and it answers "is it worth doing a
refresh right now?" for free. Claims that account email also catches silent
updates are **[contested]** and, by definition of "silent", probably false — do
not design around it.

### Playwright with a stored session and an automated OTP read

Proven to work, by the tracker cited above. [verified] Requires a macOS host to read the
OTP from the Messages database; the Pi cannot do this. Highest ToS exposure of
any option, since it is a fully automated account login. Only worth it if you
accept that and have a Mac always on.

### iOS: what actually works

- **Share Sheet Shortcut using `Run JavaScript on Webpage`** — runs in the open
  page's context, so a same-origin credentialed `fetch()` carries the HttpOnly
  session automatically. [secondary, mechanism consistent with prior work] This is the
  bookmarklet trick with a native, discoverable trigger. **Best iOS option.**
- **`Get Contents of URL`** — uses an isolated cookie store and does **not**
  reuse the Safari session. [secondary] Cannot be used for an authenticated fetch, and it
  cannot pass the OTP. Ruled out.
- **Bookmarklet in Safari favourites** — works today, but has to be launched by
  typing its name in the address bar. Keep as the cross-platform fallback.
- **Safari Web Extension (iOS 18+)** — can read cookies, but Safari's cookie
  APIs are buggy: WebKit bug 281385 [verified] breaks `cookies.set` with an
  `expirationDate` on Safari 18.0–18.3, and `cookies.getAll` returning empty in
  background contexts is a reported regression [secondary]. Viable, flaky, and installing
  it is itself friction.
- **PWA share target** — cannot make authenticated cross-origin requests or read
  cross-origin cookies. [prior] Useful only for receiving pasted text.
- **Keychain / Apple Passwords autofill** — fills the password, cannot supply the
  OTP. Helps a human sign in faster, nothing more.

### Desktop: cookie-reading extension

`chrome.cookies.getAll` returns HttpOnly cookies and their `expirationDate`, so
an extension can hand the server a session and show when it will die. [prior] But the
server can still only use it for the ~15–30 minutes before it expires, and
server-side replay is the higher-ToS-risk posture. Low value for the cost now
that the refresh is one tap.

---

## Ranked

| Avenue | Reliability | Friction | Sees silent updates | Risk | Verdict |
|---|---|---|---|---|---|
| Authenticated JSON via user-triggered same-origin fetch (bookmarklet, iOS Share-Sheet Shortcut) | high while signed in | one tap | **yes** | lowest of the working options | **primary** |
| USCIS email/text subscription → alarm to go refresh | high for its scope | one setup | no | none | **secondary signal** |
| Playwright + stored session + OTP from macOS Messages | high | low after setup | yes | highest | only with a Mac and eyes open |
| Desktop cookie extension → server poll | dies with the session | low | yes | high | not worth it now |
| iOS Safari Web Extension | medium (WebKit bugs) | medium | yes | high | second choice on iOS |
| Official developer API | high if granted | very high onboarding | thin | none | not obtainable |
| Public egov scrape | low (Cloudflare) | none | **no** | high | ruled out |
| `Get Contents of URL` Shortcut | n/a | — | — | — | impossible |

---

## What to build

1. **Delete the scheduled poller and server-side cookie storage.** They cannot
   work, and holding a live government-account session in plaintext Postgres is
   the largest liability in the system.
2. **Make the authenticated refresh one tap and self-reporting.** One trigger
   refreshes every case for a person; the tracker states what it stored. Ship an
   iOS Share-Sheet Shortcut alongside the bookmarklet.
3. **Subscribe to USCIS email/text alerts** and treat them as "go refresh now",
   not as the data.
4. **Be honest about freshness.** Show when each case was last successfully read
   and never imply the data is live.

The tracker already reads the only source that can see what the user cares
about. The problem was never the data source — it was pretending a session could
outlive its own timeout, and then hiding what a refresh actually did.
