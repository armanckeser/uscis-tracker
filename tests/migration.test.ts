import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

// Runs the real schema.sql against a real (WASM) Postgres, first on the schema as
// it shipped before v2 with data in it, so the backfills are exercised on what
// production actually looks like. The trailing agent_reader role block is cut:
// it needs a database named "app".
const upToRoles = (sql: string) => sql.replace(/\r/g, "").split("DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_roles")[0];
const legacy = fs.readFileSync("tests/fixtures/schema_v1.sql", "utf8");
const current = upToRoles(fs.readFileSync("schema.sql", "utf8"));

async function legacyDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(legacy);
  return db;
}

describe("schema.sql v2 migration", () => {
  it("backfills source, notice_details.case_id, last_changed_at and retires poll, idempotently", async () => {
    const db = await legacyDb();
    await db.exec(`
      INSERT INTO people (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'A');
      INSERT INTO cases (id, receipt_number, person_id, form_type, last_changed_at)
        VALUES ('00000000-0000-0000-0000-0000000000c1', 'IOE1234567890', '00000000-0000-0000-0000-000000000001', 'I-485', '2030-01-01T00:00:00Z');
      INSERT INTO case_snapshots (id, case_id, source, raw_hash, raw_data)
        VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'poll', 'h1',
                '{"notices":[{"letterId":"L-77","actionType":"Appointment Scheduled"}]}');
    `);
    for (const [type, at] of [["baseline", "2026-01-01"], ["submission", "2026-01-01"], ["status", "2026-02-01"], ["closed", "2026-02-02"], ["event", "2026-03-01"], ["notice", "2026-03-05"], ["silent_update", "2026-04-01"], ["field", "2026-04-01"]]) {
      await db.query(
        `INSERT INTO case_changes (case_id, snapshot_id, change_type, label, occurred_at)
         VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', $1, 'x', $2)`,
        [type, `${at}T00:00:00Z`],
      );
    }
    await db.exec(`INSERT INTO notice_details (letter_id, details) VALUES ('L-77', '{}'), ('L-gone', '{}')`);

    await db.exec(current);
    await db.exec(current); // boots twice

    const sources = await db.query<{ change_type: string; source: string }>(`SELECT change_type, source FROM case_changes ORDER BY change_type`);
    expect(Object.fromEntries(sources.rows.map((r) => [r.change_type, r.source]))).toEqual({
      baseline: "tracker",
      closed: "uscis",
      event: "uscis",
      field: "tracker",
      notice: "uscis",
      silent_update: "tracker",
      status: "uscis",
      submission: "uscis",
    });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM case_changes`)).rows[0]).toEqual({ n: 8 });

    const notes = await db.query<{ letter_id: string; case_id: string | null }>(`SELECT letter_id, case_id FROM notice_details ORDER BY letter_id`);
    expect(notes.rows).toEqual([
      { letter_id: "L-77", case_id: "00000000-0000-0000-0000-0000000000c1" },
      { letter_id: "L-gone", case_id: null },
    ]);

    const last = await db.query<{ last_changed_at: Date }>(`SELECT last_changed_at FROM cases`);
    // Newest uscis-source change (the notice), not NOW() and not the tracker rows.
    expect(last.rows[0].last_changed_at.toISOString()).toBe("2026-03-05T00:00:00.000Z");

    expect((await db.query<{ source: string }>(`SELECT source FROM case_snapshots`)).rows).toEqual([{ source: "manual" }]);
    await expect(db.exec(`UPDATE case_snapshots SET source = 'poll'`)).rejects.toThrow();
    await expect(db.exec(`UPDATE case_changes SET source = 'bogus'`)).rejects.toThrow();
    await db.exec(`UPDATE case_changes SET source = 'human' WHERE change_type = 'event'`);

    await db.exec(`UPDATE people SET category = 'EB2', chargeability = 'IN', priority_date = '2020-01-01'`);
    await db.close();
  });

  it("applies cleanly to an empty database", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(current);
    const tables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(["bulletin_dates", "processing_times", "uscis_chart", "dataset_sync", "bulletin_notifications"]));
    await db.close();
  });
});
