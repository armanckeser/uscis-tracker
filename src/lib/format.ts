// Shared date/time formatting. One place so every surface reads dates the same
// way and the Intl options are not re-spelled across components.

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function formatShortDay(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

/**
 * Formats a plain calendar date ("2026-06-22") without shifting it.
 *
 * `new Date("2026-06-22")` parses as UTC midnight, so formatting it in a local
 * zone behind UTC renders the previous day. Human-asserted facts are day
 * precision with no time and no zone, so they are read back in UTC to keep the
 * date the user typed.
 */
export function formatCalendarDay(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const dateOnly = value.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateOnly}T00:00:00Z`));
}

/** Compact "3h ago" / "2d ago" style, relative to now. */
export function relativeFromNow(value: string | null | undefined): string {
  if (!value) return "never";
  const deltaMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** "2d ago" style age, but "Xh" under a day, for the freshness pill. */
export function ageInDays(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const ms = now - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
}

/** Plural helper: plural(1, "day") is "1 day", plural(3, "day") is "3 days". */
export function plural(count: number, unit: string): string {
  return `${count.toLocaleString("en-US")} ${unit}${count === 1 ? "" : "s"}`;
}

/** "Aug 5" within the current year, "Aug 5, 2025" otherwise. For a plain calendar date. */
export function formatSmartDay(value: string | null | undefined, now = new Date()): string {
  if (!value) return "Unknown";
  const dateOnly = value.slice(0, 10);
  const sameYear = Number(dateOnly.slice(0, 4)) === now.getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateOnly}T00:00:00Z`));
}

/** "9:00 AM ET" for an instant, since USCIS keeps Eastern time. */
export function formatTimeEt(value: string): string {
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(value));
  return `${time} ET`;
}
