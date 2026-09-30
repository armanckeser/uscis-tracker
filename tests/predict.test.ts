import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBulletinRows, parseProcessingTimesCsv, parseUscisChart } from "../server/bulletinData.js";
import { assembleSummary, bulletinHistory, pageTimeline } from "../server/assemble.js";
import { predictForCase } from "../shared/expectation.js";
import { addDays, monthFromIndex, monthIndex } from "../shared/dates.js";
import { bulletinChangeNotice, predictForPerson, type BulletinData, type BulletinRow, type Chart } from "../shared/predict.js";
import { resolveProfile, type PersonProfileInput } from "../shared/profile.js";

const TODAY = "2026-09-29";

/** `n` consecutive months ending 2026-10, FAD dates given oldest first. */
function build(fad: (string | "current" | "unavailable")[], opts: { category?: string; country?: string; dff?: (string | "current")[]; chart?: Chart } = {}): BulletinData {
  const category = opts.category ?? "EB2";
  const country = opts.country ?? "IN";
  const end = monthIndex("2026-10");
  const rows: BulletinRow[] = [];
  const put = (chart: Chart, list: string[], i: number) => {
    const v = list[i];
    rows.push({
      bulletin: monthFromIndex(end - (list.length - 1 - i)),
      chart,
      kind: "employment",
      category,
      country,
      status: v === "current" ? "current" : v === "unavailable" ? "unavailable" : "date",
      date: v === "current" || v === "unavailable" ? null : v,
    });
  };
  fad.forEach((_, i) => put("final_action", fad as string[], i));
  (opts.dff ?? fad.map((d) => (d === "current" || d === "unavailable" ? d : addDays(d, 200)))).forEach((_, i, l) => put("dates_for_filing", l as string[], i));
  return { rows, uscisChart: opts.chart ? { "2026-10": { employment: opts.chart, family: null } } : {} };
}

/** A steady climb of `step` days a month from `start`. */
const climb = (start: string, step: number, months: number) => Array.from({ length: months }, (_, i) => addDays(start, step * i));
const profile = (over = {}) => ({ category: "EB2", chargeability: "IN", priorityDate: "2020-01-01", ...over });

describe("predictForPerson", () => {
  it("is current when the priority date is on or before the FAD cutoff", () => {
    const p = predictForPerson(profile({ priorityDate: "2019-06-01" }), build(climb("2019-06-01", 20, 30)), TODAY);
    expect(p).toMatchObject({ status: "ok", isCurrent: true, canFile: true, gapDays: 0, eta: null, etaReason: "current", confidence: "high" });
    expect(p.etaNote).toBe("Your date is current. A decision can come any time once USCIS finishes review.");
  });

  it("is current when the FAD is 'current'", () => {
    const p = predictForPerson(profile(), build([...climb("2019-01-01", 20, 10), "current"]), TODAY);
    expect(p).toMatchObject({ isCurrent: true, gapDays: 0 });
    expect(p.sinceLastBulletin.finalAction?.direction).toBe("became_current");
  });

  it("projects a month range for a date behind a steady advance", () => {
    // Cutoff 2019-01-01 -> +30 days a month for 30 months; PD is ~330 days ahead.
    const fad = climb("2018-01-01", 30, 30);
    const cutoff = fad.at(-1)!;
    const p = predictForPerson(profile({ priorityDate: addDays(cutoff, 300) }), build(fad), TODAY);
    expect(p.isCurrent).toBe(false);
    expect(p.gapDays).toBe(300);
    expect(p.movement.map((m) => [m.months, m.medianDaysPerMonth, m.retrogressions])).toEqual([[12, 30, 0], [24, 30, 0], [36, 30, 0]]);
    expect(p.eta).toMatchObject({ likely: "2027-08", optimistic: "2027-08", conservative: "2027-08" });
    expect(p.confidence).toBe("high");
    expect(p.explanation).toMatch(/not a prediction of future bulletins or legal advice/);
    expect(p.sinceLastBulletin.finalAction).toMatchObject({ direction: "advanced", deltaDays: 30 });
  });

  it("is deterministic", () => {
    const data = build(climb("2018-01-01", 25, 30));
    expect(predictForPerson(profile(), data, TODAY)).toEqual(predictForPerson(profile(), data, "2030-01-01"));
  });

  it("counts retrogressions and lowers confidence; slow quartile can yield no conservative month", () => {
    const fad = climb("2018-01-01", 30, 30);
    // Retrogress three times inside the window, each by 200 days.
    for (const i of [22, 25, 28]) for (let j = i; j < fad.length; j += 1) fad[j] = addDays(fad[j], -200);
    const p = predictForPerson(profile({ priorityDate: addDays(fad.at(-1)!, 500) }), build(fad), TODAY);
    expect(p.movement.find((m) => m.months === 24)!.retrogressions).toBe(3);
    expect(p.sinceLastBulletin.finalAction?.direction).toBe("advanced");
    expect(p.confidence).toBe("low");
    expect(p.eta).not.toBeNull();
  });

  it("reports a retrogression in the latest bulletin", () => {
    const fad = climb("2018-01-01", 30, 20);
    fad.push(addDays(fad.at(-1)!, -90));
    const p = predictForPerson(profile(), build(fad), TODAY);
    expect(p.sinceLastBulletin.finalAction).toMatchObject({ direction: "retrogressed", deltaDays: -90 });
    expect(bulletinChangeNotice(p)?.body).toMatch(/retrogressed 90 days/);
  });

  it("returns no ETA when the cutoff is not moving", () => {
    const p = predictForPerson(profile(), build(Array(24).fill("2015-01-01")), TODAY);
    expect(p).toMatchObject({ eta: null, etaReason: "no_forward_movement", confidence: "low" });
    expect(bulletinChangeNotice(p)).toBeNull();
  });

  it("returns no ETA with too little data", () => {
    const p = predictForPerson(profile(), build(climb("2015-01-01", 30, 4)), TODAY);
    expect(p).toMatchObject({ status: "ok", eta: null, etaReason: "insufficient_data" });
  });

  it("treats 'current' months as unknown movement, not zero", () => {
    const fad: (string | "current")[] = climb("2018-01-01", 30, 30);
    fad[15] = "current";
    const p = predictForPerson(profile({ priorityDate: addDays(fad[29] as string, 300) }), build(fad), TODAY);
    // 29 pairs, two of which touch the current month, are dropped.
    expect(p.movement.find((m) => m.months === 36)!.sampleSize).toBe(27);
  });

  it("uses the chart USCIS names, and canFile follows it", () => {
    const fad = climb("2018-01-01", 30, 30);
    const cutoff = fad.at(-1)!;
    const pd = addDays(cutoff, 100); // behind FAD, inside DFF (= FAD + 200)
    const dffPick = predictForPerson(profile({ priorityDate: pd }), build(fad, { chart: "dates_for_filing" }), TODAY);
    expect(dffPick).toMatchObject({ chartInUse: "dates_for_filing", chartSource: "uscis", isCurrent: false, canFile: true });
    const fadPick = predictForPerson(profile({ priorityDate: pd }), build(fad, { chart: "final_action" }), TODAY);
    expect(fadPick).toMatchObject({ chartInUse: "final_action", canFile: false });
    const defaults = predictForPerson(profile({ priorityDate: pd }), build(fad), TODAY);
    expect(defaults).toMatchObject({ chartInUse: "final_action", chartSource: "default" });
    const family = predictForPerson({ category: "F2A", chargeability: "ROW", priorityDate: pd }, build(fad, { category: "F2A", country: "ROW" }), TODAY);
    expect(family).toMatchObject({ chartInUse: "dates_for_filing", chartSource: "default" });
  });

  it("does not borrow ROW rows for a country the dataset covers", () => {
    const data = build(climb("2018-01-01", 30, 30), { country: "ROW" });
    expect(predictForPerson(profile({ chargeability: "BR" }), data, TODAY).status).toBe("ok");
    const withIndia = { ...data, rows: [...data.rows, { ...data.rows[0], country: "IN", category: "EB3" }] };
    expect(predictForPerson(profile({ chargeability: "IN" }), withIndia, TODAY).status).toBe("no_data");
  });

  it("asks for a profile, has no queue for immediate relatives, and no_data without rows", () => {
    const data = build(climb("2018-01-01", 30, 30));
    expect(predictForPerson({ category: "EB2", chargeability: null, priorityDate: null }, data, TODAY)).toMatchObject({ status: "needs_profile", missing: ["chargeability", "priorityDate"] });
    expect(predictForPerson({ category: "IR", chargeability: null, priorityDate: null }, data, TODAY).status).toBe("no_queue");
    expect(predictForPerson(profile({ category: "EB1" }), data, TODAY).status).toBe("no_data");
  });

  it("a derivative inherits from the principal unless overridden", () => {
    const principal: PersonProfileInput = { id: "p", category: "EB2", chargeability: "IN", priorityDate: "2020-01-01", principalPersonId: null };
    const spouse: PersonProfileInput = { id: "s", category: null, chargeability: null, priorityDate: null, principalPersonId: "p" };
    const all = new Map([principal, spouse].map((x) => [x.id, x]));
    const r = resolveProfile(spouse, all);
    expect(r.effective).toEqual({ category: "EB2", chargeability: "IN", priorityDate: "2020-01-01" });
    expect(r.inherited).toEqual({ category: true, chargeability: true, priorityDate: true });
    expect(r.complete).toBe(true);
    const override = resolveProfile({ ...spouse, chargeability: "CN" }, all);
    expect(override.effective.chargeability).toBe("CN");
    expect(override.inherited.chargeability).toBe(false);

    const data = build(climb("2018-01-01", 30, 30));
    expect(predictForPerson(r.effective, data, TODAY)).toEqual(predictForPerson(principal, data, TODAY));
    // A loop of principals terminates.
    const a: PersonProfileInput = { id: "a", category: null, chargeability: null, priorityDate: null, principalPersonId: "b" };
    const b: PersonProfileInput = { ...a, id: "b", principalPersonId: "a" };
    expect(resolveProfile(a, new Map([a, b].map((x) => [x.id, x]))).complete).toBe(false);
  });
});

describe("hand-written fixture", () => {
  const rows = parseBulletinRows(JSON.parse(fs.readFileSync("tests/fixtures/visa_bulletin.json", "utf8")));
  const uscisChart = parseUscisChart(JSON.parse(fs.readFileSync("tests/fixtures/uscis_chart.json", "utf8")));
  const data: BulletinData = { rows: rows.items, uscisChart };

  it("parses cleanly and covers 36 months", () => {
    expect(rows.skipped).toBe(0);
    expect(new Set(rows.items.map((r) => r.bulletin)).size).toBe(36);
  });

  it.each([
    ["EB2", "ROW"],
    ["EB2", "IN"],
    ["EB3", "CN"],
    ["EB3", "ROW"],
  ])("predicts for %s %s", (category, chargeability) => {
    const p = predictForPerson({ category, chargeability, priorityDate: "2030-01-01" }, data, TODAY);
    expect(p.status).toBe("ok");
    expect(p.latestBulletin).toBe("2026-10");
    expect(p.movement).toHaveLength(3);
    expect(p.chartInUse).toBe("dates_for_filing");
  });

  it("finds the fixture's EB3 India retrogression in the history endpoint shape", () => {
    const h = bulletinHistory(data.rows, "EB3", "IN");
    expect(h.months).toHaveLength(36);
    const dates = h.months.map((m) => m.finalAction!.date!);
    expect(dates.some((d, i) => i > 0 && d < dates[i - 1])).toBe(true);
    expect(h.months[0].datesForFiling?.status).toBe("date");
  });

  it("parses uscis_chart and processing_times.csv", () => {
    expect(uscisChart["2026-10"]).toEqual({ family: "dates_for_filing", employment: "dates_for_filing" });
    const pt = parseProcessingTimesCsv(fs.readFileSync("tests/fixtures/processing_times.csv", "utf8"));
    expect(pt.skipped).toBe(0);
    expect(pt.items).toHaveLength(8);
    expect(parseProcessingTimesCsv("").items).toEqual([]);
    expect(parseBulletinRows("nope").items).toEqual([]);
  });
});

describe("predictForCase", () => {
  const pt = parseProcessingTimesCsv(fs.readFileSync("tests/fixtures/processing_times.csv", "utf8")).items;
  const base = { formType: "I-765", receiptNumber: "SRC2612345678", submissionAt: "2026-06-01T15:00:00Z", lastUscisMovementAt: "2026-08-01T15:00:00Z", closed: false };

  it("gives a window from the receipt office's newest range", () => {
    const e = predictForCase(base, null, pt, null, TODAY);
    expect(e).toMatchObject({ kind: "processing_time", timeSinceFiledDays: 120, timeSinceLastMovementDays: 59 });
    expect(e.window).toMatchObject({ from: "2026-09-01", to: "2027-01-01", basis: "uscis_processing_times", snapshotDate: "2026-09-01", office: "Texas Service Center" });
  });

  it("falls back to the national row for an online receipt", () => {
    const e = predictForCase({ ...base, receiptNumber: "IOE2612345678" }, null, pt, null, TODAY);
    expect(e.window).toMatchObject({ office: null, to: "2026-11-01", from: "2026-08-01" });
  });

  it("degrades without processing times and for closed cases", () => {
    expect(predictForCase(base, null, [], null, TODAY)).toMatchObject({ kind: "none", window: null, reason: "no_processing_times" });
    expect(predictForCase({ ...base, closed: true }, null, pt, null, TODAY).reason).toBe("closed");
  });

  it("an I-485 with a non-current date shows visa availability, with a window only when there is an ETA", () => {
    const fad = climb("2018-01-01", 30, 30);
    const person = { category: "EB2", chargeability: "IN", priorityDate: addDays(fad.at(-1)!, 300) };
    const prediction = predictForPerson(person, build(fad), TODAY);
    const e = predictForCase({ ...base, formType: "I-485", receiptNumber: "IOE2612345678" }, person, pt, prediction, TODAY);
    expect(e.kind).toBe("visa_availability");
    expect(e.window).toMatchObject({ basis: "visa_availability_plus_processing_times" });

    const stalled = predictForPerson(person, build(Array(24).fill("2015-01-01")), TODAY);
    const none = predictForCase({ ...base, formType: "I-485" }, person, pt, stalled, TODAY);
    expect(none).toMatchObject({ kind: "visa_availability", window: null });

    const current = predictForPerson({ ...person, priorityDate: "2017-01-01" }, build(fad), TODAY);
    expect(predictForCase({ ...base, formType: "I-485" }, person, pt, current, TODAY).kind).toBe("processing_time");
  });
});

describe("assembleSummary", () => {
  it("builds the v2 shape and only includes raw changes with raw=1", () => {
    const input = {
      people: [{ id: "p", name: "A", category: "EB2", chargeability: "IN", priorityDate: "2020-01-01", principalPersonId: null, caseCount: 1, activeCaseCount: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
      cases: [{ id: "c", receiptNumber: "IOE1234567890", personId: "p", personName: "A", formType: "I-485", caseStatus: "x", closed: false, latestSnapshotId: null, lastCheckedAt: null, lastChangedAt: "2026-05-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
      changes: [
        { id: "1", caseId: "c", snapshotId: "s", changeType: "submission" as const, fieldPath: null, label: "", occurredAt: "2026-01-01T15:00:00Z", payload: {}, source: "uscis" as const, firstSeenAt: "2026-01-02T00:00:00Z", acknowledgedAt: null },
        ...Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, caseId: "c", snapshotId: "s", changeType: "event" as const, fieldPath: null, label: "", occurredAt: new Date(Date.UTC(2026, 0, 2) + i * 86_400_000).toISOString(), payload: { eventCode: "FTA0" }, source: "uscis" as const, firstSeenAt: "2026-06-01T00:00:00Z", acknowledgedAt: null })),
      ],
      facts: [],
      noticeDetails: [],
      bulletins: { rows: [], uscisChart: {} },
      processingTimes: [],
      config: { pushEnabled: false, vapidPublicKey: null },
      today: TODAY,
    };
    const summary = assembleSummary(input);
    expect(summary.changes).toBeUndefined();
    expect(summary.people[0].profile.effective.category).toBe("EB2");
    expect(summary.people[0].prediction.status).toBe("no_data");
    // No global LIMIT 100: all 151 days of history survive.
    expect(summary.cases[0].timeline).toHaveLength(151);
    expect(summary.cases[0].stage.stage).toBe("review");
    expect(summary.cases[0].expectation.kind).toBe("none");
    expect(assembleSummary({ ...input, raw: true }).changes).toHaveLength(151);

    const page = pageTimeline("c", summary.cases[0].timeline, 50);
    expect(page).toMatchObject({ total: 151, nextBefore: page.entries.at(-1)!.occurredAt });
    expect(pageTimeline("c", summary.cases[0].timeline, 50, page.nextBefore!).entries[0].occurredAt < page.nextBefore!).toBe(true);
    expect(pageTimeline("c", summary.cases[0].timeline, 500).nextBefore).toBeNull();
  });
});
