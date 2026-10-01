// Parsing for the public visa-bulletin dataset (armanckeser/visa-bulletin-data).
// Pure: no network, no database. Bad rows are skipped and counted, never fatal,
// because one malformed row must not stop the rest of the dataset loading.

import { z } from "zod";
import type { BulletinRow, Chart, UscisChartChoice } from "./predict.js";
import type { ProcessingTimeRow } from "./expectation.js";

export const DEFAULT_BULLETIN_BASE_URL = "https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data";

const chartSchema = z.enum(["final_action", "dates_for_filing"]);

const rowSchema = z.object({
  bulletin: z.string().regex(/^\d{4}-\d{2}$/),
  chart: chartSchema,
  kind: z.string().min(1),
  category: z.string().min(1),
  country: z.string().min(1),
  status: z.enum(["date", "current", "unavailable"]),
  date: z.string().nullable().optional(),
});

export type Parsed<T> = { items: T[]; skipped: number };

export function parseBulletinRows(json: unknown): Parsed<BulletinRow> {
  const list = Array.isArray(json) ? json : [];
  const items: BulletinRow[] = [];
  let skipped = Array.isArray(json) ? 0 : 1;
  for (const raw of list) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const row = parsed.data;
    const date = row.date ? row.date.slice(0, 10) : null;
    if (row.status === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
      skipped += 1;
      continue;
    }
    items.push({
      bulletin: row.bulletin,
      chart: row.chart,
      kind: row.kind,
      category: row.category.trim().toUpperCase(),
      country: row.country.trim().toUpperCase(),
      status: row.status,
      date: row.status === "date" ? date : null,
    });
  }
  return { items, skipped };
}

function toChart(value: unknown): Chart | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v.includes("filing")) return "dates_for_filing";
  if (v.includes("final") || v.includes("action")) return "final_action";
  return null;
}

/** `{ 'YYYY-MM': { family, employment } }`. Unknown chart names become null (the default applies). */
export function parseUscisChart(json: unknown): UscisChartChoice {
  const out: UscisChartChoice = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [month, value] of Object.entries(json as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(month) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    out[month] = { family: toChart(v.family), employment: toChart(v.employment) };
  }
  return out;
}

/** Splits one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `snapshot_date, form, form_category, office, range_low_months, range_high_months, unit` */
export function parseProcessingTimesCsv(text: string): Parsed<ProcessingTimeRow> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { items: [], skipped: 0 };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    date: col("snapshot_date"),
    form: col("form"),
    category: col("form_category"),
    office: col("office"),
    low: col("range_low_months"),
    high: col("range_high_months"),
    unit: col("unit"),
  };
  if (idx.date < 0 || idx.form < 0) return { items: [], skipped: lines.length - 1 };

  const items: ProcessingTimeRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const snapshotDate = cells[idx.date]?.slice(0, 10) ?? "";
    const form = cells[idx.form] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !form) {
      skipped += 1;
      continue;
    }
    items.push({
      snapshotDate,
      form,
      formCategory: idx.category >= 0 ? cells[idx.category] ?? "" : "",
      office: idx.office >= 0 ? cells[idx.office] ?? "" : "",
      rangeLowMonths: idx.low >= 0 ? num(cells[idx.low]) : null,
      rangeHighMonths: idx.high >= 0 ? num(cells[idx.high]) : null,
      unit: (idx.unit >= 0 ? cells[idx.unit] : "") || "months",
    });
  }
  return { items, skipped };
}
