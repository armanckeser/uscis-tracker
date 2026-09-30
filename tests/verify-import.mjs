// End-to-end check of the bookmarklet's SERVER side (not part of `npm test`):
// starts the real API against local Postgres and POSTs a valid case body to
// /api/snapshots/import exactly as the phone bookmarklet would, then asserts a
// snapshot + case row were created. Also checks the tightened CORS allowlist.
// No live USCIS contact. Run: node tests/verify-import.mjs
import { spawn } from "node:child_process";
import pg from "pg";

const DATABASE_URL = "postgresql://postgres:password@localhost:5435/app";
const API_PORT = 4112;
const RECEIPT = "IOE9999999998";
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASE_BODY = {
  data: {
    receiptNumber: RECEIPT,
    formType: "I-485",
    caseStatus: "Case Was Received",
    submissionTimestamp: "2026-01-01T15:00:00.000Z",
    updatedAtTimestamp: "2026-01-01T15:00:00.000Z",
    closed: false,
    events: [],
    notices: [],
  },
};

async function waitForApi() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://localhost:${API_PORT}/api/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error("API did not become healthy");
}

async function cleanup() {
  await pool.query(`DELETE FROM cases WHERE receipt_number = $1`, [RECEIPT]);
  await pool.query(`DELETE FROM people WHERE name = '__import_test__'`);
}

function assert(cond, label) { if (!cond) throw new Error(`FAIL: ${label}`); console.log(`ok: ${label}`); }

async function main() {
  await cleanup();
  const person = await pool.query(`INSERT INTO people (name) VALUES ('__import_test__') RETURNING id`);
  const personId = person.rows[0].id;

  const server = spawn("npx", ["tsx", "server/index.ts"], {
    env: { ...process.env, DATABASE_URL, PORT: String(API_PORT), APPLY_SCHEMA: "false" },
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    await waitForApi();

    // Bookmarklet server side: POST the fetched case JSON exactly as the
    // bookmarklet does now — a text/plain body (no-cors simple request). The
    // server must parse it regardless of Content-Type.
    const imp = await fetch(`http://localhost:${API_PORT}/api/snapshots/import`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: "https://my.uscis.gov" },
      body: JSON.stringify({ raw: CASE_BODY, personId }),
    });
    assert(imp.status === 201, "import returns 201 created from a text/plain body");
    assert(imp.headers.get("access-control-allow-origin") === "https://my.uscis.gov", "CORS allows my.uscis.gov origin (app-level)");

    const snaps = await pool.query(
      `SELECT s.id FROM case_snapshots s JOIN cases c ON c.id = s.case_id WHERE c.receipt_number = $1`,
      [RECEIPT],
    );
    assert(snaps.rows.length === 1, "a snapshot row was created from the imported JSON");

    const caseRow = await pool.query(`SELECT case_status FROM cases WHERE receipt_number = $1`, [RECEIPT]);
    assert(caseRow.rows[0]?.case_status === "Case Was Received", "case row reflects the imported status");

    // CORS preflight from a disallowed origin must NOT be granted.
    const evil = await fetch(`http://localhost:${API_PORT}/api/snapshots/import`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.test", "Access-Control-Request-Method": "POST" },
    });
    assert(evil.headers.get("access-control-allow-origin") !== "https://evil.test", "CORS rejects a disallowed origin");

    console.log("\nPASS: import works for the bookmarklet flow; CORS allows myUSCIS, rejects others");
  } finally {
    server.kill("SIGTERM");
    await cleanup();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
