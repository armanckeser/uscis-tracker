// Pure helpers for turning a USCIS appointment notice into actionable links: a
// map link to the (user-entered) location and a Google Calendar event prefilled
// with the appointment datetime. No API keys, no embeds, no network — just URLs.

const GOOGLE_CALENDAR_BASE = "https://calendar.google.com/calendar/render";
const GOOGLE_MAPS_BASE = "https://www.google.com/maps/search/";
const DEFAULT_APPOINTMENT_MINUTES = 60;

export type Appointment = {
  whenIso: string;
  letterId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(payload: unknown, key: string): string | null {
  if (!isRecord(payload)) return null;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Pulls the appointment datetime and letterId out of a notice change's payload.
 * Returns null when the payload carries no `appointmentDateTime` (i.e. the
 * notice is not an appointment).
 */
export function parseAppointment(payload: unknown): Appointment | null {
  const whenIso = stringField(payload, "appointmentDateTime");
  if (!whenIso) return null;
  return { whenIso, letterId: stringField(payload, "letterId") };
}

/**
 * Builds a map search link for a free-text address. Opens the Maps app on
 * phones (both iOS and Android resolve a Google Maps search URL to the native
 * app) and Google Maps on desktop. Returns null for an empty address so callers
 * can hide the affordance.
 */
export function mapsUrl(address: string | null | undefined): string | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;
  return `${GOOGLE_MAPS_BASE}?api=1&query=${encodeURIComponent(trimmed)}`;
}

/** Google Calendar's compact UTC stamp: 20260622T130000Z. */
function toCalendarStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type CalendarEvent = {
  title: string;
  startIso: string;
  durationMinutes?: number;
  location?: string | null;
  details?: string | null;
};

/**
 * Builds a Google Calendar "create event" link prefilled with the appointment.
 * The end time defaults to one hour after the start. Returns null when the
 * start datetime cannot be parsed.
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
  const start = new Date(event.startIso);
  if (Number.isNaN(start.getTime())) return null;

  const durationMinutes = event.durationMinutes ?? DEFAULT_APPOINTMENT_MINUTES;
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toCalendarStamp(start)}/${toCalendarStamp(end)}`,
  });
  if (event.location?.trim()) params.set("location", event.location.trim());
  if (event.details?.trim()) params.set("details", event.details.trim());

  return `${GOOGLE_CALENDAR_BASE}?${params.toString()}`;
}
