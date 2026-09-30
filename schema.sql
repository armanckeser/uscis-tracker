CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE CHECK (receipt_number ~ '^[A-Z]{3}[0-9]{10}$'),
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  form_type TEXT,
  case_status TEXT,
  closed BOOLEAN,
  latest_snapshot_id UUID,
  last_checked_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('poll', 'manual')),
  raw_hash TEXT NOT NULL,
  raw_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, raw_hash)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_cases_latest_snapshot'
  ) THEN
    ALTER TABLE cases
      ADD CONSTRAINT fk_cases_latest_snapshot
      FOREIGN KEY (latest_snapshot_id) REFERENCES case_snapshots(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS case_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES case_snapshots(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('baseline', 'submission', 'status', 'closed', 'event', 'notice', 'field', 'silent_update')),
  field_path TEXT,
  label TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  notification_sent BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE case_changes DROP CONSTRAINT IF EXISTS case_changes_change_type_check;
  ALTER TABLE case_changes
    ADD CONSTRAINT case_changes_change_type_check
    CHECK (change_type IN ('baseline', 'submission', 'status', 'closed', 'event', 'notice', 'field', 'silent_update'));
END
$$;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User-supplied details for a specific USCIS notice (keyed by its letterId).
-- The case-service API gives us the notice's datetime but never the things a
-- human must read off the paper I-797: appointment/interview address, an RFE or
-- NOID response deadline, a card tracking number. Those live here as a flexible
-- JSONB bag so a new notice kind only needs a registry entry on the frontend,
-- not a schema migration. One row per notice; details shape is owned by the app.
CREATE TABLE IF NOT EXISTS notice_details (
  letter_id TEXT PRIMARY KEY,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Retired: unattended polling. myUSCIS issues a one-time code on every sign-in
-- with no trust-this-device, so a server can never mint a session, and the one it
-- held expired well inside the poll interval. Every observation is now a
-- human-triggered import from a signed-in browser, so the stored session cookie,
-- the per-case poll switch, and the poll-run log have no meaning -- and keeping a
-- live government-account session in plaintext was the largest liability here.
-- See docs/acquisition-research.md.
ALTER TABLE people DROP COLUMN IF EXISTS uscis_cookie;
ALTER TABLE cases DROP COLUMN IF EXISTS poll_enabled;
DROP TABLE IF EXISTS poll_runs;
ALTER TABLE case_snapshots ALTER COLUMN source SET DEFAULT 'manual';

-- `last_error` went with the poller. It was the only writer: an import either
-- stores a snapshot or is never sent, so nothing can set this column any more.
-- What it left behind was worse than useless -- "Sam needs a USCIS session
-- before this case can be checked", written by the deleted poller, kept both of
-- her cases badged "Needs attention" for a condition that is now the normal way
-- the tracker works. A column with no writer cannot describe the present.
ALTER TABLE cases DROP COLUMN IF EXISTS last_error;

-- Two clocks. `occurred_at` is when USCIS did the thing; `created_at` is when we
-- found out. The timeline sorts by the first, but "has anything changed since I
-- looked?" is a question about the second, so a change also needs to record
-- whether it has been read. Without this there is no "new", only "recent" -- a
-- silent update USCIS backdates lands mid-rail under rows already read.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'case_changes' AND column_name = 'acknowledged_at'
  ) THEN
    ALTER TABLE case_changes ADD COLUMN acknowledged_at TIMESTAMPTZ;
    -- History from before this column existed has already been read. Leaving it
    -- unread would present every past row as new, exactly once, on upgrade.
    UPDATE case_changes SET acknowledged_at = NOW();
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_changes_unacknowledged
  ON case_changes(created_at DESC) WHERE acknowledged_at IS NULL;

-- Who asserted a fact. The rail used to mix USCIS facts, tracker facts ("added to
-- tracking", silent updates) and human facts on one axis. `case_facts` stays the
-- human source; every case_changes row is either USCIS's word or the tracker's.
-- Raw `field` rows are tracker-derived evidence for a silent update.
-- Added nullable, backfilled, then constrained, so this is safe on a populated
-- database and a no-op on the next boot.
ALTER TABLE case_changes ADD COLUMN IF NOT EXISTS source TEXT;
UPDATE case_changes
SET source = CASE WHEN change_type IN ('baseline', 'silent_update', 'field') THEN 'tracker' ELSE 'uscis' END
WHERE source IS NULL;
ALTER TABLE case_changes ALTER COLUMN source SET NOT NULL;
DO $$
BEGIN
  ALTER TABLE case_changes DROP CONSTRAINT IF EXISTS case_changes_source_check;
  ALTER TABLE case_changes
    ADD CONSTRAINT case_changes_source_check CHECK (source IN ('uscis', 'tracker', 'human'));
END
$$;

-- `source = 'poll'` on snapshots was the unattended poller's value; nothing can
-- write it any more. Existing rows are rewritten so the constraint can be
-- tightened; the column stays (it still says how a snapshot arrived).
UPDATE case_snapshots SET source = 'manual' WHERE source = 'poll';
DO $$
BEGIN
  ALTER TABLE case_snapshots DROP CONSTRAINT IF EXISTS case_snapshots_source_check;
  ALTER TABLE case_snapshots
    ADD CONSTRAINT case_snapshots_source_check CHECK (source IN ('manual'));
END
$$;

-- Immigration profile, per person and user-entered: the USCIS case payload has
-- no priority date or category. A derivative beneficiary points at a principal
-- and inherits whatever it does not set itself.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS chargeability TEXT,
  ADD COLUMN IF NOT EXISTS priority_date DATE,
  ADD COLUMN IF NOT EXISTS principal_person_id UUID REFERENCES people(id) ON DELETE SET NULL;

-- A notice's details belong to a case. Nullable: a letterId that no snapshot
-- carries any more stays unattached rather than being dropped.
ALTER TABLE notice_details ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE CASCADE;
UPDATE notice_details nd
SET case_id = found.case_id
FROM (
  SELECT DISTINCT ON (notice ->> 'letterId') notice ->> 'letterId' AS letter_id, s.case_id
  FROM case_snapshots s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.raw_data -> 'notices') = 'array' THEN s.raw_data -> 'notices' ELSE '[]'::jsonb END
  ) AS notice
  WHERE notice ->> 'letterId' IS NOT NULL
  ORDER BY notice ->> 'letterId', s.checked_at DESC
) found
WHERE nd.case_id IS NULL AND nd.letter_id = found.letter_id;

-- last_changed_at was NOW() at import: the tracker's clock, not USCIS's. It is
-- the newest time USCIS itself did something to the case.
UPDATE cases c
SET last_changed_at = newest.occurred_at
FROM (
  SELECT case_id, MAX(occurred_at) AS occurred_at
  FROM case_changes
  WHERE source = 'uscis'
  GROUP BY case_id
) newest
WHERE c.id = newest.case_id AND c.last_changed_at IS DISTINCT FROM newest.occurred_at;

-- Visa bulletin data, synced from the public dataset armanckeser/visa-bulletin-data.
CREATE TABLE IF NOT EXISTS bulletin_dates (
  bulletin TEXT NOT NULL CHECK (bulletin ~ '^[0-9]{4}-[0-9]{2}$'),
  chart TEXT NOT NULL CHECK (chart IN ('final_action', 'dates_for_filing')),
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('date', 'current', 'unavailable')),
  date DATE,
  PRIMARY KEY (bulletin, chart, kind, category, country)
);
CREATE INDEX IF NOT EXISTS idx_bulletin_dates_series ON bulletin_dates(category, country, chart, bulletin);

-- Which chart USCIS told applicants to use, per bulletin month.
CREATE TABLE IF NOT EXISTS uscis_chart (
  bulletin TEXT PRIMARY KEY CHECK (bulletin ~ '^[0-9]{4}-[0-9]{2}$'),
  family TEXT,
  employment TEXT
);

CREATE TABLE IF NOT EXISTS processing_times (
  snapshot_date DATE NOT NULL,
  form TEXT NOT NULL,
  form_category TEXT NOT NULL,
  office TEXT NOT NULL,
  range_low_months NUMERIC,
  range_high_months NUMERIC,
  unit TEXT NOT NULL DEFAULT 'months',
  PRIMARY KEY (snapshot_date, form, form_category, office)
);

-- Conditional-request state per dataset file, so a daily sync costs a 304.
CREATE TABLE IF NOT EXISTS dataset_sync (
  name TEXT PRIMARY KEY,
  etag TEXT,
  last_modified TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One push per person per bulletin month, however many times the sync runs.
CREATE TABLE IF NOT EXISTS bulletin_notifications (
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  bulletin TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (person_id, bulletin)
);

-- Silent updates recorded before the classifier knew what they were.
--
-- A case clock that advances with no new status, event, or notice is the one
-- movement USCIS never names, and it used to be filed as a bare `field` row on
-- `updatedAt`. Both surfaces drop `field` rows on purpose -- the rail as noise,
-- the new-since panel because a `silent_update` row is supposed to carry the same
-- movement in readable form -- so every LUD-only move observed before the fix is
-- stored and shown nowhere. Classification happens once, at import, so those rows
-- would stay invisible for good: on this database that hid four real moves,
-- including an I-485 touched on 2026-07-21 that the household went looking for.
--
-- The companion row is derived from the evidence already on file rather than
-- re-read from USCIS, which cannot be re-read anyway. Marked read at the moment
-- the field row was discovered: acknowledgement is per-discovery, those batches
-- were acknowledged, and the rail is where this belongs.
--
-- Idempotent by construction: a snapshot that already carries a silent_update is
-- skipped, so re-applying schema.sql on every boot cannot duplicate it.
INSERT INTO case_changes (
  case_id, snapshot_id, change_type, field_path, label, severity, occurred_at, payload, acknowledged_at, source
)
SELECT
  clock_move.case_id,
  clock_move.snapshot_id,
  'silent_update',
  'updatedAtTimestamp',
  COALESCE(c.form_type, 'Case') || ' silent update',
  'info',
  clock_move.occurred_at,
  jsonb_build_object(
    'old', clock_move.payload -> 'old',
    'new', clock_move.payload -> 'new',
    'caseClockAdvanced', TRUE,
    'alsoChanged', jsonb_build_array(clock_move.field_path)
  ),
  clock_move.created_at,
  'tracker'
FROM case_changes clock_move
JOIN cases c ON c.id = clock_move.case_id
WHERE clock_move.change_type = 'field'
  AND clock_move.field_path = 'updatedAt'
  AND NOT EXISTS (
    SELECT 1
    FROM case_changes existing
    WHERE existing.snapshot_id = clock_move.snapshot_id
      AND existing.change_type = 'silent_update'
  );

-- Facts only a human can assert. USCIS tells us an appointment was scheduled and
-- never tells us it happened, so "I went" is not derivable from any response --
-- which is why a passed appointment could only ever be an open question. The same
-- holds for a notice arriving in the mail days after its generationDate, or a
-- card reaching the door. These are first-class events on the timeline, not a
-- details bag hanging off a notice: they carry their own occurrence date and can
-- resolve a USCIS notice by letterId.
CREATE TABLE IF NOT EXISTS case_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('appointment_attended', 'appointment_missed')),
  -- Human memory is day-precision. Storing a fake time would imply we know more.
  occurred_on DATE NOT NULL,
  -- The USCIS notice this fact answers, when it answers one.
  letter_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One outcome per appointment notice. Re-answering replaces the answer.
  UNIQUE (case_id, letter_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_case_facts_case ON case_facts(case_id, occurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_cases_updated ON cases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_person ON cases(person_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_case_checked ON case_snapshots(case_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_case_created ON case_changes(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_created ON case_changes(created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader') THEN
    CREATE ROLE agent_reader LOGIN PASSWORD 'readonly';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE app TO agent_reader;
GRANT USAGE ON SCHEMA public TO agent_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO agent_reader;
