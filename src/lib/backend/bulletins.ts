// The visa bulletin dataset for the browser-only build. The server syncs it into
// Postgres; here the browser fetches the same public files and keeps a copy in
// IndexedDB so predictions still work offline.
//
// The whole dataset is fetched, never a slice of it: asking for one category and
// country would tell the host which queue this person is in.

import "./noEval";
import { DEFAULT_BULLETIN_BASE_URL, parseBulletinRows, parseProcessingTimesCsv, parseUscisChart } from "../../../shared/bulletinData";
import type { ProcessingTimeRow } from "../../../shared/expectation";
import type { BulletinData } from "../../../shared/predict";
import { transact } from "./idb";

export type Dataset = { bulletins: BulletinData; processingTimes: ProcessingTimeRow[] };

export type BulletinSource = { load(): Promise<Dataset> };

type Cached = Dataset & { fetchedAt: number };

const CACHE_KEY = "bulletin-dataset";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

const EMPTY: Dataset = { bulletins: { rows: [], uscisChart: {} }, processingTimes: [] };

export function bulletinBaseUrl(): string {
  return (import.meta.env.VITE_BULLETIN_BASE_URL?.trim() || DEFAULT_BULLETIN_BASE_URL).replace(/\/+$/, "");
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/**
 * Fetches the dataset. The bulletin rows are required; the chart-in-use map and
 * processing times are each optional, as they are for the server sync.
 */
export async function fetchDataset(base: string, fetchImpl: typeof fetch = fetch): Promise<Dataset | null> {
  const optional = (name: string) => fetchText(`${base}/${name}`, fetchImpl).catch(() => null);
  const [rowsText, chartText, timesText] = await Promise.all([
    fetchText(`${base}/visa_bulletin.json`, fetchImpl),
    optional("uscis_chart.json"),
    optional("processing_times.csv"),
  ]);
  if (rowsText === null) return null;
  return {
    bulletins: {
      rows: parseBulletinRows(JSON.parse(rowsText)).items,
      uscisChart: chartText ? parseUscisChart(JSON.parse(chartText)) : {},
    },
    processingTimes: timesText ? parseProcessingTimesCsv(timesText).items : [],
  };
}

export function createBulletinSource(
  db: IDBDatabase,
  { base = bulletinBaseUrl(), fetchImpl = fetch, now = Date.now }: { base?: string; fetchImpl?: typeof fetch; now?: () => number } = {},
): BulletinSource {
  let memory: Cached | null = null;
  let refreshing: Promise<Cached | null> | null = null;

  const fresh = (cached: Cached | null): cached is Cached => cached !== null && now() - cached.fetchedAt < MAX_AGE_MS;

  async function readCache(): Promise<Cached | null> {
    const row = await transact(db, ["meta"], "readonly", ({ meta }) => meta.get(CACHE_KEY));
    return (row?.value as Cached | undefined) ?? null;
  }

  function refresh(): Promise<Cached | null> {
    refreshing ??= (async () => {
      try {
        const dataset = await fetchDataset(base, fetchImpl);
        if (!dataset) return null;
        const cached: Cached = { ...dataset, fetchedAt: now() };
        memory = cached;
        await transact(db, ["meta"], "readwrite", ({ meta }) => meta.put({ key: CACHE_KEY, value: cached }));
        return cached;
      } catch {
        // Offline, or the dataset host is down. Whatever is cached still stands.
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  return {
    async load() {
      if (fresh(memory)) return memory;
      memory ??= await readCache();
      if (fresh(memory)) return memory;
      // A stale copy is shown now and replaced in the background. Only a browser
      // with no copy at all waits on the network.
      if (memory) {
        void refresh();
        return memory;
      }
      return (await refresh()) ?? EMPTY;
    },
  };
}
