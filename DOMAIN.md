# Domain

A fact-based map of USCIS case tracking, the hot spots where the current build
contradicts it, and the acquisition avenues that are actually available.

Method: EventStorming (Brandolini) — orange facts in past tense, purple
policies, green read models, red hot spots. Time model: bitemporal (Fowler) —
every fact carries both the time it happened and the time we learned it.

---

## 1. The two clocks

This is the root of most defects in the current build.

| Clock | Field(s) today | Answers |
|---|---|---|
| **Case time** (valid time) | `updatedAtTimestamp`, `generationDate`, `createdAtTimestamp`, `appointmentDateTime` | *When did USCIS do this?* |
| **Observation time** (record time) | `case_snapshots.checked_at`, `case_changes.created_at` | *When did we find out?* |

The timeline sorts and groups by case time only. `case_changes.created_at` is
stored and never read. So:

- A change discovered today, stamped by USCIS last week, renders *below* rows
  the user has already seen. Nothing marks it as new.
- "Did anything change since I last looked?" — the product's stated first
  question — is not expressible as a query against the current model.

A third clock matters and is entirely absent: **paper time**. The I-797 arrives
days after `generationDate` and carries facts the API never returns
(appointment address, RFE deadline, card tracking). Today those live in a flat
`notice_details` JSONB bag keyed by `letterId`, outside the event log, so they
cannot appear on the timeline or drive the aggregate.

---

## 2. Actors

- **Applicant** / **Spouse** — each owns a myUSCIS account and a set of cases.
- **USCIS** — the upstream system. Never pushes to us. Only ever *observed*.
- **USPS** — carries notices and cards; introduces paper-time lag.
- **Tracker scheduler** — wants to observe unattended; structurally cannot (§5).
- **Agent** — reads history, explains movement, evolves the tool.

---

## 3. Domain facts

Marked by source: `[U]` observed from USCIS, `[H]` only a human can assert,
`[T]` the tracker's own fact.

### Filing
- `[H]` Package was mailed
- `[U]` Application was received *(`submissionTimestamp`)*
- `[U]` Receipt notice was generated
- `[H]` Receipt notice arrived in mail
- `[T]` Case was added to tracking

### Biometrics
- `[U]` Biometrics appointment was scheduled *(`appointmentDateTime`)*
- `[H]` Appointment notice arrived in mail — **carries the location the API omits**
- `[U]` Appointment was rescheduled
- `[H]` **Appointment was attended** ← no representation today; see HS-2
- `[H]` Appointment was missed
- `[U]` Biometrics were reused / fee was waived

### Interim benefits
- `[U]` EAD (I-765) was approved
- `[U]` Travel document (I-131) was approved
- `[U]` Card production was ordered
- `[U]` Card was mailed / was picked up by USPS / was delivered
- `[H]` Card arrived in hand

### Adjudication
- `[U]` Case is being actively reviewed
- `[U]` RFE was issued
- `[H]` RFE letter arrived — **carries the response deadline**
- `[H]` RFE response was mailed
- `[U]` RFE response was received
- `[U]` NOID was issued
- `[U]` Interview was scheduled / was waived
- `[H]` Interview was attended
- `[U]` Case was transferred to another office
- `[U]` Case was assigned to a new office

### Decision
- `[U]` Case was approved / was denied
- `[U]` Green card was mailed / was delivered
- `[H]` Appeal or motion was filed

### Observation (the tracker's own domain — currently unmodelled)
- `[T]` Case document was observed *(the atomic fact — everything else is derived)*
- `[T]` Observation matched the previous one *(no movement)*
- `[T]` Observation differed *(→ derive change facts)*
- `[T]` Observation failed *(session rejected / network / upstream error)*
- `[T]` Session went stale
- `[T]` **Change was acknowledged by the user** ← no representation today; see HS-3

The last one is load-bearing. Without it there is no "new", only "recent".

---

## 4. Policies

- Whenever an observation differs from the previous one → record change facts.
- Whenever a change of interest is recorded → notify once.
- Whenever an appointment's datetime passes with no outcome recorded → **ask
  the human what happened**. Do not silently keep showing it as upcoming.
- Whenever a notice kind appears that needs paper detail → ask for those fields.
- Whenever an RFE deadline is near and no response is recorded → escalate.
- Whenever a session is rejected → stop replaying it and ask for a reconnect.

---

## 5. Hot spots

Each was confirmed against the code when found. State as of domain v2:

| | Hot spot | State |
|---|---|---|
| HS-1 | A silent update was defined as an absence, so it vanished | **Fixed.** `silent_update` is a positive fact (the case clock or an unnamed field moved and USCIS named nothing), source `tracker`. Raw `field` rows are no longer written; their diffs ride on the silent update's `fieldDiffs` payload. Old `field` rows stay, marked `tracker`, and never render. |
| HS-2 | An appointment had no lifecycle | **Handled in the read model.** `deriveStage` treats an appointment with a future `appointmentDateTime` as an obligation on the person, and a past one with no `case_facts` outcome as a prompt to record it. |
| HS-3 | No acknowledgement, so nothing was "new" | **Partly fixed.** `acknowledged_at` exists and timeline entries carry `unread`. Acknowledgement is still household-wide, not per person. |
| HS-4 | Evidence pointed at the oldest proof | **Open (UI).** Every timeline entry lists its underlying `snapshotId`s; choosing which to open is a UI decision. |
| HS-5 | Human facts were a JSONB bag | **Fixed for outcomes.** `case_facts` rows are timeline entries with source `human`. `notice_details` (paper-notice fields) is still a bag but now carries `case_id`. |
| HS-6 | Unattended polling is impossible | **Resolved by removal.** No poller, no stored cookie. Every observation is a human-triggered import. See docs/acquisition-research.md. |
| HS-7 | The bookmarklet reports delivery, not import | **Open.** `no-cors` still hides the response. |
| HS-8 | Import could reassign a case | **Fixed.** Import derives the owner from the receipt number. |
| HS-9 | The daily loop costs about 7 actions per case | **Open (UI).** |

Also fixed in v2: the server's copy of the event wording contradicted the
client's (FTA0 read "Action completed" server-side and "Actively reviewing" in
the UI). There is now one registry, `shared/lifecycle.ts`, used by both.
`/api/summary` no longer truncates history with a global `LIMIT 100`.
`cases.last_changed_at` is the newest time USCIS acted, not the tracker's clock.

---

## 6. Read models the product needs

1. **Anything new?** — unacknowledged changes across all cases, ordered by
   *observation* time, each acknowledgeable. This is the home screen.
2. **Where does each case stand** — current status, one line, per case.
3. **What do I owe** — next obligation with an explicit resolution action:
   upcoming appointment, appointment awaiting an outcome, RFE deadline.
4. **Audit rail** — the full log in case time. Secondary, not the landing view.
5. **Trust** — when each case was last successfully observed, by which source,
   and whether that is stale.

---

## 7. Acquisition avenues

Constraint to design against: **USCIS never pushes, and any credential held
server-side expires faster than any useful poll interval.** The only reliable
source of a fresh authenticated observation is a browser that is *already
signed in*. So the design goal is not "automate the fetch" — it is **minimise
the number of human actions between "I am signed in" and "the tracker holds
current JSON for every case."**

The reason no credential survives: **myUSCIS issues a one-time code on every
sign-in and offers no "trust this device"**, so a server can never mint a new
session. The one it holds expires on a ~15–30 minute idle timeout, which is
shorter than the poll interval that depends on it.

Two sources are worth having, and only one of them can see a silent update:

| Source | Push or pull | Friction | Sees silent updates |
|---|---|---|---|
| USCIS email/text status subscription | push | one setup | no — visible status changes only |
| Authenticated one-tap human refresh | pull, human-gated | 1 action for all cases | yes — full document incl. the case clock |

The subscription is free and answers "is it worth refreshing right now". The
authenticated refresh is the only thing that sees a silent update, so it must be
one tap and must report honestly what it stored.

Two avenues that look like fallbacks are not: the public `egov` status check is
Cloudflare-gated *and* structurally blind to silent updates, and the official
developer API is gated behind a G-1595 filing and a live demo while returning
less than we already read.

Avenue detail, ranked recommendation, and the confidence level of each claim are
in `docs/acquisition-research.md`.

---

## 8. Consequences for the build

- `silent_update` becomes a first-class derived fact from the case clock, not a
  fallback for an empty diff. Nothing observable is ever filtered out of the
  rail without being counted somewhere visible.
- Every change carries both clocks and an acknowledgement state.
- Human facts become events with their own occurrence time.
- An appointment resolves: passed appointments prompt for an outcome instead of
  masquerading as upcoming.
- Import derives its person from the receipt number; `personId` is required
  only for a receipt the tracker has never seen.
- Import returns, and the UI states, what actually happened: stored / no change
  / rejected — never an unconditional success toast.
- Server-side cookie replay and the connector extension are removed, not fixed.

---

## 9. Fact sources, stage, and predictions (v2)

**Sources.** Every `case_changes` row is `uscis` (USCIS said it: event,
notice, status, closed, submission) or `tracker` (baseline, silent_update, raw
field diffs). `case_facts` is `human`. Only `uscis` rows move the stage,
`last_changed_at`, or push.

**Timeline.** `normalizeTimeline` folds same-code events (and silent updates)
on one US Eastern date into one entry with a `count`; the originals stay in
`entries`. Significance is `milestone` (filed, biometrics or interview
scheduled, RFE/NOID, approved, denied, card produced/mailed/delivered),
`step` (reviewing, transferred, other notices, unknown codes) or `quiet`
(silent update, baseline).

**Stage.** `filed -> biometrics -> review -> interview -> decision -> card ->
closed`, derived (never stored) from the furthest stage any USCIS entry reached,
plus `nextStep` and `waitingOn` (`uscis`, `you`, `visa_availability`).

**Profile.** The USCIS payload carries no priority date, category or
chargeability, so they are entered per person. A derivative points at a
principal and inherits what it does not set.

**Predictions.** Visa bulletin data comes from the public dataset
`armanckeser/visa-bulletin-data` (`VISA_BULLETIN_BASE_URL`, a URL or a local
directory). ETAs are deterministic quantiles of trailing monthly final-action
advances, reported as a month range, and always labelled an estimate.
