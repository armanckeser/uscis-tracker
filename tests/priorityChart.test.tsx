import { describe, expect, it } from "vitest";
import { buildChartModel, nearestPoint } from "../src/features/prediction/chartMath.js";
import { deltaFor, explanationBody, headlineFor } from "../src/features/prediction/predictionCopy.js";
import { personSummary } from "./support/v2.js";
import type { BulletinHistory, PersonPrediction } from "../src/lib/types.js";

const TODAY = new Date("2026-09-29T12:00:00.000Z");

function history(): BulletinHistory {
  // 36 bulletins Oct 2023 .. Sep 2026: the cutoff creeps forward, with one gap.
  const months: BulletinHistory["months"] = [];
  for (let i = 0; i < 36; i += 1) {
    const idx = 2023 * 12 + 9 + i;
    const bulletin = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
    const cutoff = new Date(Date.UTC(2018, 0, 1 + i * 20)).toISOString().slice(0, 10);
    months.push({
      bulletin,
      finalAction: i === 10 ? { status: "unavailable", date: null } : { status: "date", date: cutoff },
      datesForFiling: null,
    });
  }
  return { category: "EB2", country: "IN", months };
}

const eta = { optimistic: "2027-04", likely: "2027-08", conservative: "2028-02", basis: { windowMonths: 24 as const, sampleSize: 23, daysPerMonth: { p25: 5, median: 20, p75: 40 } } };

describe("buildChartModel", () => {
  const model = buildChartModel({ history: history(), priorityDate: "2021-03-04", prediction: { eta, isCurrent: false }, width: 360 })!;

  it("plots_every_bulletin_and_breaks_the_line_at_an_unavailable_month", () => {
    expect(model.points).toHaveLength(36);
    expect(model.points[10].y).toBeNull();
    expect(model.linePaths).toHaveLength(2);
    expect(model.gapPaths).toHaveLength(2);
  });

  it("keeps_the_priority_date_line_and_every_point_inside_the_plot", () => {
    const { top, bottom } = model.plot;
    expect(model.pdY).toBeGreaterThanOrEqual(top);
    expect(model.pdY).toBeLessThanOrEqual(bottom);
    for (const point of model.points) if (point.y !== null) expect(point.y).toBeGreaterThanOrEqual(top);
  });

  it("puts_a_later_cutoff_higher_on_the_chart", () => {
    const [first, last] = [model.points[0], model.points[35]];
    expect(last.y!).toBeLessThan(first.y!);
  });

  it("draws_a_fan_from_the_last_point_to_the_priority_date_line_when_there_is_an_eta", () => {
    expect(model.fan).not.toBeNull();
    const last = model.points[35];
    expect(model.fan!.area.startsWith(`M${last.x} ${last.y}`)).toBe(true);
    expect(model.fan!.area).toContain(` ${model.pdY}`);
    expect(model.fan!.endX).toBeLessThanOrEqual(model.plot.right);
  });

  it("draws_no_fan_when_the_date_is_current_or_there_is_no_eta", () => {
    const current = buildChartModel({ history: history(), priorityDate: "2018-06-01", prediction: { eta, isCurrent: true }, width: 360 })!;
    const none = buildChartModel({ history: history(), priorityDate: "2021-03-04", prediction: { eta: null, isCurrent: false }, width: 360 })!;

    expect(current.fan).toBeNull();
    expect(none.fan).toBeNull();
  });

  it("returns_nothing_to_draw_without_enough_history", () => {
    expect(buildChartModel({ history: { category: "EB2", country: "IN", months: [] }, priorityDate: "2021-03-04", prediction: { eta: null, isCurrent: false }, width: 360 })).toBeNull();
  });

  it("finds_the_bulletin_nearest_a_pointer", () => {
    expect(nearestPoint(model.points, model.points[7].x + 1)).toBe(7);
    expect(nearestPoint(model.points, -50)).toBe(0);
    expect(nearestPoint(model.points, 9999)).toBe(35);
  });
});

function prediction(over: Partial<PersonPrediction>): PersonPrediction {
  return { ...personSummary().prediction, status: "ok", ...over };
}

describe("headlineFor", () => {
  it("says_the_date_is_current", () => {
    expect(headlineFor(prediction({ isCurrent: true }), TODAY)).toMatchObject({ kind: "current", title: "Your date is current" });
  });

  it("gives_the_eta_range_in_months_and_the_likely_month", () => {
    const headline = headlineFor(prediction({ isCurrent: false, eta }), TODAY);

    expect(headline.title).toBe("About 7–17 months to go");
    expect(headline.sub).toBe("most likely Aug 2027");
  });

  it("says_plus_when_the_slow_pace_never_arrives", () => {
    const headline = headlineFor(prediction({ isCurrent: false, eta: { ...eta, conservative: null } }), TODAY);

    expect(headline.title).toBe("7+ months to go");
  });

  it("says_not_moving_with_the_reason", () => {
    const headline = headlineFor(prediction({ isCurrent: false, eta: null, etaReason: "no_forward_movement", etaNote: "The cutoff has not advanced in a year." }), TODAY);

    expect(headline).toMatchObject({ kind: "stalled", title: "Not moving right now", sub: "The cutoff has not advanced in a year." });
  });

  it("does_not_call_thin_data_stalled", () => {
    expect(headlineFor(prediction({ isCurrent: false, eta: null, etaReason: "insufficient_data" }), TODAY).kind).toBe("unknown");
  });
});

describe("deltaFor", () => {
  const since = (direction: string, deltaDays: number | null) =>
    ({ fromBulletin: "2026-09", toBulletin: "2026-10", fromDate: null, toDate: null, fromStatus: "date", toStatus: "date", deltaDays, direction }) as never;

  it("shows_days_up_in_success", () => {
    expect(deltaFor(since("advanced", 45))).toEqual({ text: "+45 days", direction: "up", tone: "success" });
  });

  it("shows_months_down_in_warning_with_a_real_minus", () => {
    expect(deltaFor(since("retrogressed", -91))).toEqual({ text: "−3 months", direction: "down", tone: "warning" });
  });

  it("shows_no_change", () => {
    expect(deltaFor(since("unchanged", 0))?.text).toBe("No change");
  });

  it("has_nothing_to_show_without_a_comparison", () => {
    expect(deltaFor(null)).toBeNull();
  });
});

describe("explanationBody", () => {
  it("drops_the_legal_advice_sentence_because_the_card_prints_its_own", () => {
    const body = explanationBody("Your date is not current. It moves about 20 days a month. This is an estimate from past movement, not legal advice.");

    expect(body).toBe("Your date is not current. It moves about 20 days a month.");
  });
});
