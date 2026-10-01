import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import pg from "pg";
import webpush from "web-push";
import { z } from "zod";
import {
  buildChanges,
  hashCaseData,
  isValidReceipt,
  normalizeReceipt,
  normalizeUscisResponse,
  type ChangeDraft,
  type UscisCaseData,
} from "../shared/domain.js";
import { assembleSummary, bulletinHistory, pageTimeline, type CaseInput, type PersonInput } from "../shared/assemble.js";
import { bulletinBaseUrl, loadBulletinData, loadProcessingTimes, syncDatasets } from "./bulletinSync.js";
import { selectNotifiable, type PushItem } from "./notify.js";
import { bulletinChangeNotice, predictForPerson } from "../shared/predict.js";
import { resolveProfile, type PersonProfileInput } from "../shared/profile.js";
import { normalizeTimeline, type ChangeRecord, type FactRecord } from "../shared/timeline.js";
import type { PatchPersonBody, RawChange } from "../shared/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(process.cwd(), "server/.env") });
dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5435/app";
const APPLY_SCHEMA = process.env.APPLY_SCHEMA !== "false";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const BULLETIN_SYNC = process.env.BULLETIN_SYNC !== "false";
const BULLETIN_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:uscis-tracker@localhost";
/** Where the app is served from, e.g. https://uscis.example.com. The API only accepts calls from it. */
const APP_ORIGIN = process.env.APP_ORIGIN ?? "https://uscis.example.com";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
}

type CaseRow = {
  id: string;
  receipt_number: string;
  person_id: string;
  person_name: string;
  form_type: string | null;
  case_status: string | null;
  closed: boolean | null;
  latest_snapshot_id: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  created_at: string;
  updated_at: string;
};

type PersonRow = {
  id: string;
  name: string;
  category: string | null;
  chargeability: string | null;
  priority_date: string | null;
  principal_person_id: string | null;
  case_count: number;
  active_case_count: number;
  created_at: string;
  updated_at: string;
};

const caseSchema = z.object({
  receiptNumber: z.string().transform(normalizeReceipt).refine(isValidReceipt, "Receipt number must be 3 letters followed by 10 numbers."),
  personId: z.string().uuid(),
});

// `personId` is only needed for a receipt the tracker has never seen. For a
// known receipt the case already records its owner, so the import derives it and
// the caller does not have to be asked who this snapshot belongs to.
const importSchema = z.object({
  raw: z.unknown(),
  personId: z.string().uuid().optional(),
});

const personSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const upperOrNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value.toUpperCase()))
    .nullable();

const patchPersonSchema = z.object({
  category: upperOrNull(16).optional(),
  chargeability: upperOrNull(16).optional(),
  priority_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.").nullable().optional(),
  principal_person_id: z.string().uuid().nullable().optional(),
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// A notice's user-entered details (address, due date, tracking number, ...).
// The shape is intentionally open: the frontend's lifecycle registry decides
// which fields a given notice kind needs, so the server only enforces that
// values are short strings and stores the bag verbatim.
const noticeDetailsSchema = z.object({
  details: z.record(z.string(), z.string().max(500)).default({}),
});

type NoticeDetailRow = { letter_id: string; case_id: string | null; details: Record<string, string>; updated_at: string };

type CaseFactRow = {
  id: string;
  case_id: string;
  kind: "appointment_attended" | "appointment_missed";
  occurred_on: string;
  letter_id: string | null;
  note: string | null;
  created_at: string;
};

function mapCaseFact(row: CaseFactRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    kind: row.kind,
    occurredOn: row.occurred_on,
    letterId: row.letter_id,
    note: row.note,
    createdAt: iso(row.created_at)!,
  };
}

const caseFactSchema = z.object({
  kind: z.enum(["appointment_attended", "appointment_missed"]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
  letterId: z.string().min(1).max(64).optional(),
  note: z.string().trim().max(500).optional(),
});

function mapNoticeDetail(row: NoticeDetailRow) {
  return { letterId: row.letter_id, caseId: row.case_id, details: row.details, updatedAt: iso(row.updated_at)! };
}

async function applySchema() {
  if (!APPLY_SCHEMA) return;
  const candidates = [
    path.resolve(process.cwd(), "schema.sql"),
    path.resolve(__dirname, "../schema.sql"),
  ];
  for (const candidate of candidates) {
    try {
      const sql = await fs.readFile(candidate, "utf8");
      await pool.query(sql);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("schema.sql was not found.");
}

// pg hands back Date objects for timestamptz. The API and the pure domain
// functions both want ISO strings, so convert once at the edge.
const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(value as string | number | Date).toISOString());

function mapCase(row: CaseRow) {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    personId: row.person_id,
    personName: row.person_name,
    formType: row.form_type,
    caseStatus: row.case_status,
    closed: row.closed,
    latestSnapshotId: row.latest_snapshot_id,
    lastCheckedAt: iso(row.last_checked_at),
    lastChangedAt: iso(row.last_changed_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapPerson(row: PersonRow) {
  return {
    id: row.id,
    name: row.name,
    caseCount: Number(row.case_count ?? 0),
    activeCaseCount: Number(row.active_case_count ?? 0),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapChange(row: Record<string, unknown>) {
  return {
    id: row.id,
    caseId: row.case_id,
    snapshotId: row.snapshot_id,
    receiptNumber: row.receipt_number,
    formType: row.form_type,
    personId: row.person_id,
    personName: row.person_name,
    changeType: row.change_type,
    source: row.source,
    fieldPath: row.field_path,
    label: row.label,
    severity: row.severity,
    occurredAt: iso(row.occurred_at)!,
    payload: row.payload,
    firstSeenAt: iso(row.created_at)!,
    acknowledgedAt: iso(row.acknowledged_at),
  };
}

async function getPeople() {
  const { rows } = await pool.query<PersonRow>(
    `SELECT
       p.*,
       p.priority_date::text AS priority_date,
       COUNT(c.id)::int AS case_count,
       COUNT(c.id) FILTER (WHERE c.closed IS DISTINCT FROM TRUE)::int AS active_case_count
     FROM people p
     LEFT JOIN cases c ON c.person_id = p.id
     GROUP BY p.id
     ORDER BY p.created_at, p.name`,
  );
  return rows;
}

/**
 * Inserts or refreshes the case row for an observed response.
 *
 * A receipt number identifies exactly one case and the case already knows its
 * owner, so an import never rewrites `person_id`: the conflict branch used to
 * set it from the request, which meant one wrong pick in the import dropdown
 * silently moved a case to another person. Reassignment stays an explicit
 * PATCH /api/cases/:id.
 */
async function upsertCase(client: pg.PoolClient, data: UscisCaseData, personId: string) {
  const { rows } = await client.query<CaseRow>(
    `INSERT INTO cases (receipt_number, person_id, form_type, case_status, closed)
     SELECT $1, p.id, $3, $4, $5
     FROM people p
     WHERE p.id = $2
     ON CONFLICT (receipt_number) DO UPDATE SET
       form_type = COALESCE(EXCLUDED.form_type, cases.form_type),
       case_status = COALESCE(EXCLUDED.case_status, cases.case_status),
       closed = COALESCE(EXCLUDED.closed, cases.closed),
       updated_at = NOW()
     RETURNING cases.*,
       (SELECT name FROM people WHERE id = cases.person_id) AS person_name`,
    [data.receiptNumber, personId, data.formType ?? null, data.caseStatus ?? null, data.closed ?? null],
  );
  if (!rows[0]) throw new Error("Person not found.");
  return rows[0];
}

async function saveSnapshot(client: pg.PoolClient, caseRow: CaseRow, data: UscisCaseData) {
  const checkedAt = new Date().toISOString();
  const rawHash = await hashCaseData(data);

  const { rows: previousRows } = await client.query<{ raw_data: UscisCaseData }>(
    `SELECT raw_data FROM case_snapshots WHERE case_id = $1 ORDER BY checked_at DESC LIMIT 1`,
    [caseRow.id],
  );
  const previous = previousRows[0]?.raw_data ?? null;

  const { rows: insertedRows } = await client.query<{ id: string; checked_at: string }>(
    `INSERT INTO case_snapshots (case_id, checked_at, raw_hash, raw_data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (case_id, raw_hash) DO NOTHING
     RETURNING id, checked_at`,
    [caseRow.id, checkedAt, rawHash, data],
  );

  if (insertedRows.length === 0) {
    await client.query(
      `UPDATE cases SET
         form_type = COALESCE($2, form_type),
         case_status = COALESCE($3, case_status),
         closed = COALESCE($4, closed),
         last_checked_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [caseRow.id, data.formType ?? null, data.caseStatus ?? null, data.closed ?? null],
    );
    return { outcome: "unchanged" as const, snapshotId: null, changes: [] as ChangeDraft[], shouldNotify: false, changeIds: [] as string[], notifiable: [] as PushItem[] };
  }

  const snapshot = insertedRows[0];
  const changes = buildChanges(previous, data, snapshot.checked_at);

  // The first snapshot of a case is history being imported, not news, so it
  // starts acknowledged. Otherwise adding a case would open with twenty unread
  // rows describing things the user already knows.
  const acknowledgedAt = previous ? null : new Date().toISOString();

  const changeIds: string[] = [];
  for (const change of changes) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO case_changes (case_id, snapshot_id, change_type, source, field_path, label, severity, occurred_at, payload, acknowledged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [caseRow.id, snapshot.id, change.changeType, change.source, change.fieldPath, change.label, change.severity, change.occurredAt, change.payload, acknowledgedAt],
    );
    changeIds.push(rows[0].id);
  }

  await client.query(
    `UPDATE cases SET
       form_type = COALESCE($2, form_type),
       case_status = COALESCE($3, case_status),
       closed = COALESCE($4, closed),
       latest_snapshot_id = $5,
       last_checked_at = NOW(),
       last_changed_at = COALESCE(
         (SELECT MAX(occurred_at) FROM case_changes WHERE case_id = $1 AND source = 'uscis'),
         last_changed_at
       ),
       updated_at = NOW()
     WHERE id = $1`,
    [caseRow.id, data.formType ?? null, data.caseStatus ?? null, data.closed ?? null, snapshot.id],
  );

  // The first snapshot is history being imported, not news.
  const notifiable = previous ? selectNotifiable(changes, caseRow.id, data.formType ?? caseRow.form_type) : [];
  return {
    outcome: "stored" as const,
    snapshotId: snapshot.id,
    changes,
    changeIds,
    notifiable,
    shouldNotify: notifiable.length > 0,
  };
}

async function sendPushToAll(title: string, body: string, tag: string, url = "/") {
  if (!pushEnabled) return false;

  const { rows } = await pool.query<{ id: string; endpoint: string; keys_p256dh: string; keys_auth: string }>(
    `SELECT * FROM push_subscriptions ORDER BY created_at DESC`,
  );

  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.keys_p256dh, auth: row.keys_auth } },
        JSON.stringify({ title, body, tag, data: { url } }),
      );
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.id]);
      } else {
        console.error("Push delivery failed", error);
      }
    }
  }));
  return true;
}

// Origins allowed to call the API: the app itself, the phone-refresh bookmarklets
// (which POST snapshots from a logged-in my.uscis.gov tab), and local dev hosts.
const ALLOWED_ORIGINS = [
  APP_ORIGIN,
  "https://my.uscis.gov",
  "http://localhost:5181",
  "http://localhost:5173",
  "http://127.0.0.1:5181",
  "http://127.0.0.1:5173",
];

const app = new Hono();
app.use("/api/*", cors({ origin: ALLOWED_ORIGINS }));

app.get("/api/health", async (c) => {
  const people = await getPeople();
  return c.json({ ok: true, people: people.length, pushEnabled });
});

type SummarySource = {
  people: PersonInput[];
  cases: CaseInput[];
  changes: (ChangeRecord & Pick<RawChange, "receiptNumber" | "formType" | "personId" | "personName" | "severity">)[];
  facts: FactRecord[];
  noticeDetails: ReturnType<typeof mapNoticeDetail>[];
};

/** Everything the summary is built from. The one place that reads all cases and all history. */
async function loadSummarySource(): Promise<SummarySource> {
  const [people, cases, changes, noticeDetails, facts] = await Promise.all([
    getPeople(),
    pool.query<CaseRow>(
      `SELECT c.*, p.name AS person_name
       FROM cases c
       JOIN people p ON p.id = c.person_id
       ORDER BY c.created_at DESC`,
    ),
    // No LIMIT: history is complete, and the timeline is per case.
    pool.query(
      `SELECT cc.*, c.receipt_number, c.form_type, c.person_id, p.name AS person_name
       FROM case_changes cc
       JOIN cases c ON c.id = cc.case_id
       JOIN people p ON p.id = c.person_id
       ORDER BY cc.occurred_at DESC, cc.created_at DESC`,
    ),
    pool.query<NoticeDetailRow>(`SELECT letter_id, case_id, details, updated_at FROM notice_details`),
    pool.query<CaseFactRow>(`SELECT id, case_id, kind, occurred_on::text, letter_id, note, created_at FROM case_facts ORDER BY occurred_on DESC`),
  ]);
  return {
    people: people.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      chargeability: row.chargeability,
      priorityDate: row.priority_date,
      principalPersonId: row.principal_person_id,
      caseCount: Number(row.case_count ?? 0),
      activeCaseCount: Number(row.active_case_count ?? 0),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
    })),
    cases: cases.rows.map(mapCase),
    changes: changes.rows.map(mapChange) as unknown as SummarySource["changes"],
    facts: facts.rows.map(mapCaseFact),
    noticeDetails: noticeDetails.rows.map(mapNoticeDetail),
  };
}

async function buildSummary(raw: boolean) {
  const source = await loadSummarySource();
  const byId = new Map<string, PersonProfileInput>(source.people.map((p) => [p.id, p]));
  const categories = source.people.map((p) => resolveProfile(p, byId).effective.category).filter((c): c is string => Boolean(c));
  const [bulletins, processingTimes] = await Promise.all([loadBulletinData(pool, categories), loadProcessingTimes(pool)]);
  return assembleSummary({
    ...source,
    bulletins,
    processingTimes,
    config: { pushEnabled, vapidPublicKey: VAPID_PUBLIC_KEY ?? null },
    today: new Date().toISOString().slice(0, 10),
    raw,
  });
}

// Normalized entries per case; the raw changes only ship with ?raw=1.
app.get("/api/summary", async (c) => {
  return c.json(await buildSummary(c.req.query("raw") === "1"));
});

app.get("/api/cases/:id/timeline", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 500);
  const before = c.req.query("before") || undefined;
  const id = c.req.param("id");
  const exists = await pool.query(`SELECT 1 FROM cases WHERE id = $1`, [id]);
  if (!exists.rowCount) return c.json({ error: "Case not found." }, 404);
  const [changes, facts] = await Promise.all([
    pool.query(
      `SELECT cc.*, c.receipt_number, c.form_type, c.person_id, p.name AS person_name
       FROM case_changes cc JOIN cases c ON c.id = cc.case_id JOIN people p ON p.id = c.person_id
       WHERE cc.case_id = $1`,
      [id],
    ),
    pool.query<CaseFactRow>(`SELECT id, case_id, kind, occurred_on::text, letter_id, note, created_at FROM case_facts WHERE case_id = $1`, [id]),
  ]);
  const timeline = normalizeTimeline(changes.rows.map(mapChange) as unknown as ChangeRecord[], facts.rows.map(mapCaseFact));
  return c.json(pageTimeline(id, timeline, limit, before));
});

app.get("/api/bulletins/history", async (c) => {
  const category = c.req.query("category")?.trim();
  const country = c.req.query("country")?.trim() || "ROW";
  if (!category) return c.json({ error: "category is required." }, 400);
  const data = await loadBulletinData(pool, [category]);
  return c.json(bulletinHistory(data.rows, category, country));
});

app.patch("/api/people/:id", async (c) => {
  const body: PatchPersonBody = patchPersonSchema.parse(await c.req.json());
  const id = c.req.param("id");

  if (body.principal_person_id === id) return c.json({ error: "A person cannot be their own principal." }, 400);
  if (body.principal_person_id) {
    // Refuse a cycle: walk up from the proposed principal and make sure we never reach this person.
    const { rows } = await pool.query<{ id: string; principal_person_id: string | null }>(`SELECT id, principal_person_id FROM people`);
    const parent = new Map(rows.map((r) => [r.id, r.principal_person_id]));
    if (!parent.has(body.principal_person_id)) return c.json({ error: "Principal not found." }, 404);
    let cursor: string | null | undefined = body.principal_person_id;
    for (let hops = 0; cursor && hops < 20; hops += 1) {
      if (cursor === id) return c.json({ error: "That would make a loop of principals." }, 400);
      cursor = parent.get(cursor);
    }
  }

  // Only the keys sent change; null clears.
  const sets: string[] = [];
  const values: unknown[] = [id];
  const push = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (body.category !== undefined) push("category", body.category);
  if (body.chargeability !== undefined) push("chargeability", body.chargeability);
  if (body.priority_date !== undefined) push("priority_date", body.priority_date);
  if (body.principal_person_id !== undefined) push("principal_person_id", body.principal_person_id);
  if (sets.length === 0) return c.json({ error: "Nothing to update." }, 400);

  const { rowCount } = await pool.query(`UPDATE people SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`, values);
  if (!rowCount) return c.json({ error: "Person not found." }, 404);

  const summary = await buildSummary(false);
  return c.json({ person: summary.people.find((person) => person.id === id) });
});

app.post("/api/people", async (c) => {
  const body = personSchema.parse(await c.req.json());
  const { rows } = await pool.query<PersonRow>(
    `INSERT INTO people (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET updated_at = people.updated_at
     RETURNING *, 0::int AS case_count, 0::int AS active_case_count`,
    [body.name],
  );
  return c.json({ person: mapPerson(rows[0]) }, 201);
});

app.post("/api/cases", async (c) => {
  const body = caseSchema.parse(await c.req.json());
  const { rows } = await pool.query<CaseRow>(
    `INSERT INTO cases (receipt_number, person_id)
     SELECT $1, p.id
     FROM people p
     WHERE p.id = $2
     ON CONFLICT (receipt_number) DO UPDATE SET
       person_id = EXCLUDED.person_id,
       updated_at = NOW()
     RETURNING cases.*,
       (SELECT name FROM people WHERE id = cases.person_id) AS person_name`,
    [body.receiptNumber, body.personId],
  );
  if (!rows[0]) return c.json({ error: "Person not found." }, 404);
  return c.json({ case: mapCase(rows[0]) }, 201);
});

app.patch("/api/cases/:id", async (c) => {
  const body = z.object({ personId: z.string().uuid() }).parse(await c.req.json());
  const { rows } = await pool.query<CaseRow>(
    `UPDATE cases SET person_id = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING cases.*,
       (SELECT name FROM people WHERE id = cases.person_id) AS person_name`,
    [c.req.param("id"), body.personId],
  );
  if (!rows[0]) return c.json({ error: "Case not found." }, 404);
  return c.json({ case: mapCase(rows[0]) });
});

app.delete("/api/cases/:id", async (c) => {
  await pool.query(`DELETE FROM cases WHERE id = $1`, [c.req.param("id")]);
  return c.json({ ok: true });
});

app.post("/api/snapshots/import", async (c) => {
  const body = importSchema.parse(await c.req.json());
  const data = normalizeUscisResponse(body.raw);

  const { rows: ownerRows } = await pool.query<{ person_id: string }>(
    `SELECT person_id FROM cases WHERE receipt_number = $1`,
    [data.receiptNumber],
  );
  const personId = ownerRows[0]?.person_id ?? body.personId;
  if (!personId) {
    return c.json(
      { error: `${data.receiptNumber} is not tracked yet. Add the case, or choose who it belongs to.` },
      400,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const caseRow = await upsertCase(client, data, personId);
    const result = await saveSnapshot(client, caseRow, data);
    const { rows } = await client.query<CaseRow>(
      `SELECT c.*, p.name AS person_name
       FROM cases c
       JOIN people p ON p.id = c.person_id
       WHERE c.id = $1`,
      [caseRow.id],
    );
    await client.query("COMMIT");

    // A refresh is triggered from a signed-in USCIS tab, often on a phone, and
    // often by the other person in the household. Push is how whoever did not
    // run it finds out something moved.
    if (result.notifiable.length > 0) {
      // One push per distinct thing that happened (the tag collapses repeats on
      // the OS side). Only USCIS-sourced milestones and steps get here.
      const shown = result.notifiable.slice(0, 3);
      const extra = result.notifiable.length - shown.length;
      let delivered = false;
      for (const [i, item] of shown.entries()) {
        const body = i === shown.length - 1 && extra > 0 ? `${item.body} (+${extra} more update${extra === 1 ? "" : "s"})` : item.body;
        delivered = (await sendPushToAll(item.title, body, item.tag)) || delivered;
      }
      if (delivered) {
        const ids = result.notifiable.flatMap((item) => item.covers.map((index) => result.changeIds[index]));
        await pool.query(`UPDATE case_changes SET notification_sent = TRUE WHERE id = ANY($1::uuid[])`, [ids]);
      }
    }

    const { notifiable: _notifiable, changeIds: _changeIds, ...visible } = result;
    return c.json({ case: mapCase(rows[0]), ...visible }, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

/**
 * Marks everything currently unread as read. There is one household using this,
 * so the queue is shared and "I have seen this" is a single act rather than a
 * per-row state to reconcile across two people.
 */
app.post("/api/changes/acknowledge", async (c) => {
  const { rowCount } = await pool.query(
    `UPDATE case_changes SET acknowledged_at = NOW() WHERE acknowledged_at IS NULL`,
  );
  return c.json({ acknowledged: rowCount ?? 0 });
});

app.get("/api/snapshots/:id", async (c) => {
  const { rows } = await pool.query(
    `SELECT s.*, c.receipt_number, c.form_type
     FROM case_snapshots s
     JOIN cases c ON c.id = s.case_id
     WHERE s.id = $1`,
    [c.req.param("id")],
  );
  if (!rows[0]) return c.json({ error: "Snapshot not found." }, 404);
  return c.json({ snapshot: rows[0] });
});

/**
 * Records what a human knows and USCIS never says: that an appointment was
 * attended, or missed. Re-answering the same appointment replaces the answer
 * rather than stacking a second contradictory fact.
 */
app.post("/api/cases/:id/facts", async (c) => {
  const body = caseFactSchema.parse(await c.req.json());
  const { rows } = await pool.query<CaseFactRow>(
    `INSERT INTO case_facts (case_id, kind, occurred_on, letter_id, note)
     SELECT id, $2, $3::date, $4, $5 FROM cases WHERE id = $1
     ON CONFLICT (case_id, letter_id, kind) DO UPDATE SET
       occurred_on = EXCLUDED.occurred_on,
       note = EXCLUDED.note
     RETURNING id, case_id, kind, occurred_on::text, letter_id, note, created_at`,
    [c.req.param("id"), body.kind, body.occurredOn, body.letterId ?? null, body.note ?? null],
  );
  if (!rows[0]) return c.json({ error: "Case not found." }, 404);

  // Answering "did you go?" one way retires the opposite answer, so a corrected
  // outcome does not leave both on the timeline.
  const opposite = body.kind === "appointment_attended" ? "appointment_missed" : "appointment_attended";
  await pool.query(
    `DELETE FROM case_facts WHERE case_id = $1 AND letter_id IS NOT DISTINCT FROM $2 AND kind = $3`,
    [rows[0].case_id, body.letterId ?? null, opposite],
  );

  return c.json({ fact: mapCaseFact(rows[0]) }, 201);
});

app.delete("/api/facts/:id", async (c) => {
  await pool.query(`DELETE FROM case_facts WHERE id = $1`, [c.req.param("id")]);
  return c.json({ ok: true });
});

app.get("/api/notice-details", async (c) => {
  const { rows } = await pool.query<NoticeDetailRow>(
    `SELECT letter_id, case_id, details, updated_at FROM notice_details`,
  );
  return c.json({ noticeDetails: rows.map(mapNoticeDetail) });
});

app.put("/api/notice-details/:letterId", async (c) => {
  const body = noticeDetailsSchema.parse(await c.req.json());
  const { rows } = await pool.query<NoticeDetailRow>(
    `INSERT INTO notice_details (letter_id, details, case_id)
     VALUES ($1, $2, (
       SELECT cc.case_id FROM case_changes cc
       WHERE cc.change_type = 'notice' AND cc.payload ->> 'letterId' = $1
       ORDER BY cc.created_at DESC LIMIT 1
     ))
     ON CONFLICT (letter_id) DO UPDATE SET
       details = EXCLUDED.details,
       case_id = COALESCE(notice_details.case_id, EXCLUDED.case_id),
       updated_at = NOW()
     RETURNING letter_id, case_id, details, updated_at`,
    [c.req.param("letterId"), body.details],
  );
  return c.json({ noticeDetail: mapNoticeDetail(rows[0]) });
});

app.post("/api/push/subscribe", async (c) => {
  const body = pushSubscriptionSchema.parse(await c.req.json());
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, keys_p256dh, keys_auth)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET keys_p256dh = EXCLUDED.keys_p256dh, keys_auth = EXCLUDED.keys_auth`,
    [body.endpoint, body.keys.p256dh, body.keys.auth],
  );
  return c.json({ ok: true });
});

app.post("/api/push/unsubscribe", async (c) => {
  const body = z.object({ endpoint: z.string().url() }).parse(await c.req.json());
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [body.endpoint]);
  return c.json({ ok: true });
});

app.onError((error, c) => {
  console.error(error);
  const message = error instanceof z.ZodError ? "Request did not match the expected shape." : error.message;
  return c.json({ error: message }, error instanceof z.ZodError ? 400 : 500);
});

await applySchema();

/**
 * Pulls the public visa-bulletin dataset and, when a new bulletin month landed,
 * pushes once per tracked person whose category and country moved. Never throws:
 * the dataset repo may be unpublished, and a failed sync must not take the API down.
 */
async function syncBulletins() {
  try {
    const report = await syncDatasets(pool, bulletinBaseUrl());
    console.log("Visa bulletin sync", JSON.stringify(report));
    // First ever load is history, not news. Only a newer month than before notifies.
    if (!report.latestBefore || !report.latestAfter || report.latestAfter <= report.latestBefore) return;

    const source = await loadSummarySource();
    const byId = new Map<string, PersonProfileInput>(source.people.map((p) => [p.id, p]));
    const resolved = source.people.map((p) => ({ person: p, effective: resolveProfile(p, byId).effective }));
    const bulletins = await loadBulletinData(
      pool,
      resolved.map((r) => r.effective.category).filter((cat): cat is string => Boolean(cat)),
    );
    for (const { person, effective } of resolved) {
      const notice = bulletinChangeNotice(predictForPerson(effective, bulletins, new Date()));
      if (!notice) continue;
      const claim = await pool.query(
        `INSERT INTO bulletin_notifications (person_id, bulletin) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [person.id, report.latestAfter],
      );
      if (!claim.rowCount) continue;
      await sendPushToAll(`${person.name}: ${notice.title}`, notice.body, `bulletin:${person.id}:${report.latestAfter}`);
    }
  } catch (error) {
    console.error("Visa bulletin sync failed", error);
  }
}

if (BULLETIN_SYNC) {
  void syncBulletins();
  setInterval(() => void syncBulletins(), BULLETIN_SYNC_INTERVAL_MS).unref();
}

serve({ fetch: app.fetch, port: PORT });
console.log(`USCIS Tracker API listening on http://localhost:${PORT}`);
