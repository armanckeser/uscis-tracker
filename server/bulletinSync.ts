import fs from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { parseBulletinRows, parseProcessingTimesCsv, parseUscisChart } from "./bulletinData.js";
import { categoryCandidates, type BulletinData, type BulletinRow } from "../shared/predict.js";
import type { ProcessingTimeRow } from "../shared/expectation.js";

export const DEFAULT_BULLETIN_BASE_URL = "https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data";

/**
 * Where the dataset files live. `VISA_BULLETIN_BASE_URL` may be an http(s) URL
 * or a local directory (for example `tests/fixtures`) holding visa_bulletin.json,
 * uscis_chart.json and processing_times.csv.
 */
export function bulletinBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VISA_BULLETIN_BASE_URL?.trim() || DEFAULT_BULLETIN_BASE_URL).replace(/\/+$/, "");
}

type Validators = { etag: string | null; lastModified: string | null };
type Fetched = { kind: "ok"; text: string; validators: Validators } | { kind: "not_modified" } | { kind: "missing" };

export async function fetchDatasetFile(base: string, name: string, known: Validators | null, fetchImpl: typeof fetch = fetch): Promise<Fetched> {
  if (!/^https?:\/\//i.test(base)) {
    // A local directory has no ETag; always re-read it, it is cheap and it is dev/test only.
    const dir = base.replace(/^file:\/\//i, "");
    try {
      return { kind: "ok", text: await fs.readFile(path.resolve(dir, name), "utf8"), validators: { etag: null, lastModified: null } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      throw error;
    }
  }
  const headers: Record<string, string> = {};
  if (known?.etag) headers["If-None-Match"] = known.etag;
  else if (known?.lastModified) headers["If-Modified-Since"] = known.lastModified;
  const response = await fetchImpl(`${base}/${name}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (response.status === 304) return { kind: "not_modified" };
  if (response.status === 404) return { kind: "missing" };
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return {
    kind: "ok",
    text: await response.text(),
    validators: { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") },
  };
}

export type SyncReport = {
  latestBefore: string | null;
  latestAfter: string | null;
  files: Record<string, "synced" | "not_modified" | "missing" | "error">;
  rows: { bulletin: number; processingTimes: number };
  skipped: number;
};

async function chunked<T>(items: T[], size: number, run: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await run(items.slice(i, i + size));
}

/**
 * Pulls the dataset into Postgres. Each file is independent: a missing or
 * failing processing_times.csv must not stop bulletin dates loading, and the
 * repo may not be published yet at all, in which case this reports "missing" and
 * changes nothing.
 */
export async function syncDatasets(pool: pg.Pool, base = bulletinBaseUrl(), fetchImpl: typeof fetch = fetch): Promise<SyncReport> {
  const report: SyncReport = { latestBefore: null, latestAfter: null, files: {}, rows: { bulletin: 0, processingTimes: 0 }, skipped: 0 };
  report.latestBefore = (await pool.query<{ latest: string | null }>(`SELECT MAX(bulletin) AS latest FROM bulletin_dates`)).rows[0]?.latest ?? null;

  const known = async (name: string): Promise<Validators | null> => {
    const { rows } = await pool.query<{ etag: string | null; last_modified: string | null }>(`SELECT etag, last_modified FROM dataset_sync WHERE name = $1`, [name]);
    return rows[0] ? { etag: rows[0].etag, lastModified: rows[0].last_modified } : null;
  };
  const remember = (name: string, v: Validators) =>
    pool.query(
      `INSERT INTO dataset_sync (name, etag, last_modified, synced_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (name) DO UPDATE SET etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified, synced_at = NOW()`,
      [name, v.etag, v.lastModified],
    );

  async function file(name: string, apply: (text: string) => Promise<void>) {
    try {
      const got = await fetchDatasetFile(base, name, await known(name), fetchImpl);
      if (got.kind !== "ok") {
        report.files[name] = got.kind;
        return;
      }
      await apply(got.text);
      await remember(name, got.validators);
      report.files[name] = "synced";
    } catch (error) {
      console.error(`Dataset sync failed for ${name}`, error);
      report.files[name] = "error";
    }
  }

  await file("visa_bulletin.json", async (text) => {
    const { items, skipped } = parseBulletinRows(JSON.parse(text));
    report.skipped += skipped;
    report.rows.bulletin = items.length;
    await chunked(items, 2000, (chunk) =>
      pool.query(
        `INSERT INTO bulletin_dates (bulletin, chart, kind, category, country, status, date)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::date[])
         ON CONFLICT (bulletin, chart, kind, category, country) DO UPDATE SET status = EXCLUDED.status, date = EXCLUDED.date`,
        [
          chunk.map((r) => r.bulletin),
          chunk.map((r) => r.chart),
          chunk.map((r) => r.kind),
          chunk.map((r) => r.category),
          chunk.map((r) => r.country),
          chunk.map((r) => r.status),
          chunk.map((r) => r.date),
        ],
      ),
    );
  });

  await file("uscis_chart.json", async (text) => {
    const chart = parseUscisChart(JSON.parse(text));
    for (const [bulletin, value] of Object.entries(chart)) {
      await pool.query(
        `INSERT INTO uscis_chart (bulletin, family, employment) VALUES ($1, $2, $3)
         ON CONFLICT (bulletin) DO UPDATE SET family = EXCLUDED.family, employment = EXCLUDED.employment`,
        [bulletin, value.family ?? null, value.employment ?? null],
      );
    }
  });

  await file("processing_times.csv", async (text) => {
    const { items, skipped } = parseProcessingTimesCsv(text);
    report.skipped += skipped;
    report.rows.processingTimes = items.length;
    await chunked(items, 1000, (chunk) =>
      pool.query(
        `INSERT INTO processing_times (snapshot_date, form, form_category, office, range_low_months, range_high_months, unit)
         SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::text[])
         ON CONFLICT (snapshot_date, form, form_category, office) DO UPDATE SET
           range_low_months = EXCLUDED.range_low_months, range_high_months = EXCLUDED.range_high_months, unit = EXCLUDED.unit`,
        [
          chunk.map((r) => r.snapshotDate),
          chunk.map((r) => r.form),
          chunk.map((r) => r.formCategory),
          chunk.map((r) => r.office),
          chunk.map((r) => r.rangeLowMonths),
          chunk.map((r) => r.rangeHighMonths),
          chunk.map((r) => r.unit),
        ],
      ),
    );
  });

  report.latestAfter = (await pool.query<{ latest: string | null }>(`SELECT MAX(bulletin) AS latest FROM bulletin_dates`)).rows[0]?.latest ?? null;
  return report;
}

type BulletinDbRow = { bulletin: string; chart: BulletinRow["chart"]; kind: string; category: string; country: string; status: BulletinRow["status"]; date: string | null };

/** Bulletin rows for the given profile categories (all of them when none given), plus the chart-in-use map. */
export async function loadBulletinData(pool: pg.Pool, categories?: string[]): Promise<BulletinData> {
  const wanted = categories ? [...new Set(categories.flatMap((c) => categoryCandidates(c)))] : null;
  const [rows, charts] = await Promise.all([
    pool.query<BulletinDbRow>(
      `SELECT bulletin, chart, kind, category, country, status, date::text AS date
       FROM bulletin_dates
       ${wanted ? "WHERE category = ANY($1::text[])" : ""}
       ORDER BY bulletin`,
      wanted ? [wanted] : [],
    ),
    pool.query<{ bulletin: string; family: BulletinRow["chart"] | null; employment: BulletinRow["chart"] | null }>(`SELECT bulletin, family, employment FROM uscis_chart`),
  ]);
  const uscisChart: BulletinData["uscisChart"] = {};
  for (const row of charts.rows) uscisChart[row.bulletin] = { family: row.family, employment: row.employment };
  return { rows: rows.rows, uscisChart };
}

export async function loadProcessingTimes(pool: pg.Pool): Promise<ProcessingTimeRow[]> {
  const { rows } = await pool.query<{
    snapshot_date: string;
    form: string;
    form_category: string;
    office: string;
    range_low_months: string | null;
    range_high_months: string | null;
    unit: string;
  }>(`SELECT snapshot_date::text, form, form_category, office, range_low_months, range_high_months, unit FROM processing_times`);
  return rows.map((r) => ({
    snapshotDate: r.snapshot_date,
    form: r.form,
    formCategory: r.form_category,
    office: r.office,
    rangeLowMonths: r.range_low_months === null ? null : Number(r.range_low_months),
    rangeHighMonths: r.range_high_months === null ? null : Number(r.range_high_months),
    unit: r.unit,
  }));
}
