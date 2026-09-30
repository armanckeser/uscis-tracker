// Geometry for the "place in line" chart. Pure: numbers in, SVG path strings
// out, so the shapes can be tested without a DOM.
//
// x is a bulletin month, y is the cutoff date. Both are plain numbers (month
// index, days since epoch) mapped linearly into a plot box.

import { monthIndex } from "../../../shared/dates";
import type { BulletinHistory, PersonPrediction } from "../../lib/types";

export const CHART_HEIGHT = 140;
const MARGIN = { top: 24, right: 12, bottom: 20, left: 34 };
const MAX_BULLETINS = 36;
const MIN_HORIZON = 12;
const MAX_HORIZON = 72;

const DAY_MS = 86_400_000;

export function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

export type ChartPoint = {
  bulletin: string;
  status: "date" | "current" | "unavailable";
  date: string | null;
  x: number;
  /** Null for an unavailable month. A current month plots at the top of the chart. */
  y: number | null;
};

export type Tick = { pos: number; label: string };

export type ChartModel = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  points: ChartPoint[];
  /** One step-line path per unbroken run of bulletins. */
  linePaths: string[];
  /** Lime-soft area between the cutoff and the priority date, one per run. */
  gapPaths: string[];
  /** The priority date line, or null when it falls outside every series (never: the domain includes it). */
  pdY: number;
  fan: { area: string; likely: string; endX: number } | null;
  xTicks: Tick[];
  yTicks: Tick[];
  lastPoint: ChartPoint | null;
};

type Input = {
  history: BulletinHistory;
  priorityDate: string;
  prediction: Pick<PersonPrediction, "eta" | "isCurrent">;
  width: number;
  height?: number;
};

const r = (n: number) => Math.round(n * 10) / 10;

function yearOfMonthIndex(index: number) {
  return Math.floor(index / 12);
}

export function buildChartModel({ history, priorityDate, prediction, width, height = CHART_HEIGHT }: Input): ChartModel | null {
  const months = history.months.slice(-MAX_BULLETINS).filter((m) => m.finalAction);
  if (months.length < 2) return null;

  const plot = { left: MARGIN.left, right: width - MARGIN.right, top: MARGIN.top, bottom: height - MARGIN.bottom };
  const plotW = plot.right - plot.left;
  const plotH = plot.bottom - plot.top;

  const raw = months.map((m) => ({
    bulletin: m.bulletin,
    idx: monthIndex(m.bulletin),
    status: m.finalAction!.status,
    date: m.finalAction!.date,
    value: m.finalAction!.status === "date" && m.finalAction!.date ? dayNumber(m.finalAction!.date) : null,
  }));

  const pd = dayNumber(priorityDate);
  const dates = raw.map((p) => p.value).filter((v): v is number => v !== null);
  let lo = Math.min(pd, ...dates);
  let hi = Math.max(pd, ...dates);
  const pad = Math.max(30, (hi - lo) * 0.08);
  lo -= pad;
  hi += pad;
  const yOf = (value: number) => plot.top + ((hi - value) / (hi - lo)) * plotH;

  const x0 = raw[0].idx;
  const xLastIdx = raw[raw.length - 1].idx;
  const last = raw[raw.length - 1];

  // Projection: months until the cutoff reaches the priority date, at the
  // optimistic, likely and conservative pace. Only for a date that is not current.
  const eta = prediction.isCurrent ? null : prediction.eta;
  const off = (month: string | null) => (month ? Math.max(1, monthIndex(month) - xLastIdx) : null);
  const optOff = eta ? off(eta.optimistic) : null;
  const likelyOff = eta ? off(eta.likely) : null;
  const consOff = eta ? off(eta.conservative) : null;
  const horizon = eta
    ? Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.ceil((consOff ?? (likelyOff ?? 12) * 1.3) + 1)))
    : 0;
  const xMaxIdx = xLastIdx + horizon;
  const span = Math.max(1, xMaxIdx - x0);
  const xOf = (idx: number) => plot.left + ((idx - x0) / span) * plotW;

  const points: ChartPoint[] = raw.map((p) => ({
    bulletin: p.bulletin,
    status: p.status,
    date: p.date,
    x: r(xOf(p.idx)),
    y: p.status === "unavailable" ? null : r(p.value === null ? plot.top : yOf(p.value)),
  }));

  // Runs: unbroken stretches of available bulletins.
  const runs: ChartPoint[][] = [];
  for (const point of points) {
    if (point.y === null) {
      runs.push([]);
      continue;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push(point);
  }
  const usable = runs.filter((run) => run.length > 0);

  const pdY = r(yOf(pd));
  const linePaths: string[] = [];
  const gapPaths: string[] = [];
  for (const run of usable) {
    let line = `M${run[0].x} ${run[0].y}`;
    for (let i = 1; i < run.length; i += 1) line += `H${run[i].x}V${run[i].y}`;
    linePaths.push(line);

    // Shade only where the cutoff is still short of the priority date.
    const clamp = (y: number) => Math.max(y, pdY);
    let area = `M${run[0].x} ${pdY}H${run[run.length - 1].x}V${r(clamp(run[run.length - 1].y!))}`;
    for (let i = run.length - 1; i >= 1; i -= 1) area += `V${r(clamp(run[i - 1].y!))}H${run[i - 1].x}`;
    area += "Z";
    gapPaths.push(area);
  }

  const lastPoint = points[points.length - 1];
  let fan: ChartModel["fan"] = null;
  if (eta && optOff && likelyOff && lastPoint.y !== null && last.value !== null) {
    const lx = lastPoint.x;
    const ly = lastPoint.y;
    const endX = r(xOf(xMaxIdx));
    const optX = r(xOf(xLastIdx + optOff));
    const likelyX = r(xOf(xLastIdx + likelyOff));
    // With no conservative month the slow pace never arrives: that edge runs flat.
    const consEnd = consOff ? `${r(xOf(xLastIdx + consOff))} ${pdY}` : `${endX} ${ly}`;
    fan = {
      area: `M${lx} ${ly}L${optX} ${pdY}L${consEnd}Z`,
      likely: `M${lx} ${ly}L${likelyX} ${pdY}`,
      endX,
    };
  }

  // Ticks: every January in range, thinned to keep labels apart.
  const xTicks: Tick[] = [];
  for (let idx = x0; idx <= xMaxIdx; idx += 1) {
    if (idx % 12 === 0) xTicks.push({ pos: r(xOf(idx)), label: String(yearOfMonthIndex(idx)) });
  }
  if (xTicks.length === 0) xTicks.push({ pos: r(xOf(x0)), label: String(yearOfMonthIndex(x0)) });
  const thinned = xTicks.length > 6 ? xTicks.filter((_, i) => i % Math.ceil(xTicks.length / 6) === 0) : xTicks;

  const yTicks: Tick[] = [];
  const firstYear = new Date((lo + 1) * DAY_MS).getUTCFullYear();
  const lastYear = new Date(hi * DAY_MS).getUTCFullYear();
  const step = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 4));
  for (let year = firstYear; year <= lastYear; year += step) {
    const v = dayNumber(`${year}-01-01`);
    if (v > lo && v < hi) yTicks.push({ pos: r(yOf(v)), label: String(year) });
  }

  return { width, height, plot, points, linePaths, gapPaths, pdY, fan, xTicks: thinned, yTicks, lastPoint };
}

/** The bulletin closest to a pointer's x, for scrubbing. */
export function nearestPoint(points: ChartPoint[], x: number): number {
  let best = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
  }
  return best;
}
