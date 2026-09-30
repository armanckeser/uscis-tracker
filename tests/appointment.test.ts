import { describe, expect, it } from "vitest";
import { googleCalendarUrl, mapsUrl, parseAppointment } from "../src/lib/appointment.js";
import { formatCalendarDay } from "../src/lib/format.js";
import { lookupEvent, lookupNotice } from "../shared/lifecycle.js";

// The real biometrics notice Alex pasted: a notice payload carries
// appointmentDateTime + letterId, and the case-service API never carries the
// location. These tests guard that the appointment is extracted and turned into
// working map/calendar links, and that the lifecycle registry resolves the
// notice/event strings (incl. close wording variants and unknown codes).

describe("parseAppointment", () => {
  it("extracts datetime and letterId from a real appointment notice payload", () => {
    const payload = {
      receiptNumber: "IOE1234567801",
      letterId: "400000001",
      generationDate: "2026-06-05T23:48:45.573Z",
      appointmentDateTime: "2026-06-22T13:00:00.000Z",
      actionType: "Appointment Scheduled",
    };
    expect(parseAppointment(payload)).toEqual({
      whenIso: "2026-06-22T13:00:00.000Z",
      letterId: "400000001",
    });
  });

  it("returns null when the notice carries no appointmentDateTime", () => {
    const payload = { letterId: "999", actionType: "Case Was Approved" };
    expect(parseAppointment(payload)).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(parseAppointment(null)).toBeNull();
    expect(parseAppointment("nope")).toBeNull();
  });
});

describe("mapsUrl", () => {
  it("builds a Google Maps search link from a free-text address", () => {
    expect(mapsUrl("USCIS ASC, 100 Example Plaza, Springfield IL 62701")).toBe(
      "https://www.google.com/maps/search/?api=1&query=USCIS%20ASC%2C%20100%20Example%20Plaza%2C%20Springfield%20IL%2062701",
    );
  });

  it("returns null for an empty or whitespace address", () => {
    expect(mapsUrl("")).toBeNull();
    expect(mapsUrl("   ")).toBeNull();
    expect(mapsUrl(null)).toBeNull();
  });
});

describe("googleCalendarUrl", () => {
  it("prefills a one-hour event from the appointment datetime in UTC", () => {
    const url = googleCalendarUrl({
      title: "USCIS Biometrics Appointment",
      startIso: "2026-06-22T13:00:00.000Z",
      location: "USCIS ASC, Springfield IL",
    });
    expect(url).toBe(
      "https://calendar.google.com/calendar/render?action=TEMPLATE&text=USCIS+Biometrics+Appointment&dates=20260622T130000Z%2F20260622T140000Z&location=USCIS+ASC%2C+Springfield+IL",
    );
  });

  it("honors a custom duration", () => {
    const url = googleCalendarUrl({
      title: "Interview",
      startIso: "2026-06-22T13:00:00.000Z",
      durationMinutes: 30,
    });
    expect(url).toContain("dates=20260622T130000Z%2F20260622T133000Z");
  });

  it("returns null for an unparseable start datetime", () => {
    expect(googleCalendarUrl({ title: "x", startIso: "not-a-date" })).toBeNull();
  });
});

describe("lifecycle registry", () => {
  it("resolves the confirmed 'Appointment Scheduled' notice as an appointment with a fillable location", () => {
    const entry = lookupNotice("Appointment Scheduled");
    expect(entry?.title).toBe("Appointment scheduled");
    expect(entry?.isAppointment).toBe(true);
    expect(entry?.fillable?.some((field) => field.kind === "address")).toBe(true);
  });

  it("resolves close wording variants to the same kind", () => {
    expect(lookupNotice("Biometrics Appointment Was Scheduled")?.isAppointment).toBe(true);
    expect(lookupNotice("Request For Evidence Was Sent")?.title).toBe("Request for evidence (RFE)");
    expect(lookupNotice("Card Was Mailed To Me")?.title).toBe("Card mailed");
  });

  it("returns null for an unknown notice so the caller can show the raw string", () => {
    expect(lookupNotice("Some Brand New 2027 Notice Type")).toBeNull();
    expect(lookupNotice(null)).toBeNull();
  });

  it("resolves known event codes and degrades for unknown ones", () => {
    expect(lookupEvent("IAF")?.title).toBe("Application filed");
    expect(lookupEvent("sa")?.title).toBe("Status adjusted");
    expect(lookupEvent("ZZZ")).toBeNull();
  });
});

describe("formatCalendarDay", () => {
  it("renders_a_day_precision_fact_without_shifting_it_a_day_earlier", () => {
    // Regression guarded: `new Date("2026-06-22")` parses as UTC midnight, so
    // formatting it in any zone behind UTC renders Jun 21. A human fact carries no
    // time and no zone, so "I went on Jun 22" must read back as Jun 22 everywhere.
    expect(formatCalendarDay("2026-06-22")).toBe("Jun 22, 2026");
  });

  it("tolerates_a_timestamp_shaped_value_by_taking_its_date_part", () => {
    expect(formatCalendarDay("2026-06-22T04:00:00.000Z")).toBe("Jun 22, 2026");
  });

  it("reports_unknown_for_a_missing_date", () => {
    expect(formatCalendarDay(null)).toBe("Unknown");
  });
});
