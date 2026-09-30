// Pure date helpers shared by the server and the client. Everything here works
// on ISO strings so results never depend on the machine's time zone, except
// `easternDate`, which is the one place "local date" is defined on purpose.

export const ET_TIME_ZONE = "America/New_York";

const easternFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date (YYYY-MM-DD) an instant falls on in US Eastern time, where USCIS keeps its clock. */
export function easternDate(iso: string): string {
  return easternFormatter.format(new Date(iso));
}

/** Whole days from `a` to `b` (YYYY-MM-DD or ISO instants; only the date part is used). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD for a Date or ISO string, in UTC. */
export function toIsoDate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** 'YYYY-MM' to a month count, for arithmetic on bulletin months. */
export function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

export function monthFromIndex(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Adds whole months (clamping the day) plus any fractional part as days at 30.4375 days a month. */
export function addMonthsToDate(date: string, months: number): string {
  const whole = Math.trunc(months);
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + whole);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  const out = d.toISOString().slice(0, 10);
  const frac = months - whole;
  return frac === 0 ? out : addDays(out, Math.round(frac * 30.4375));
}
