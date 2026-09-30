import { describe, expect, it } from "vitest";
import { netDaysPerMonth, predictForPerson, type BulletinRow } from "../shared/predict.js";

// A step series: the cutoff sits still for 5 months, then jumps 150 days, repeating.
function stepRows(): BulletinRow[] {
  const rows: BulletinRow[] = [];
  let cutoff = new Date("2012-01-01T00:00:00Z");
  for (let i = 0; i < 30; i += 1) {
    const y = 2024 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    if (i > 0 && i % 6 === 0) cutoff = new Date(cutoff.getTime() + 150 * 86400000);
    rows.push({
      bulletin: `${y}-${String(m).padStart(2, "0")}`,
      chart: "final_action",
      kind: "employment",
      category: "EB2",
      country: "IN",
      status: "date",
      date: cutoff.toISOString().slice(0, 10),
    } as BulletinRow);
  }
  return rows;
}

describe("net cutoff movement", () => {
  it("sees jumps a median of monthly deltas would read as zero", () => {
    const series = stepRows().map((r) => ({ bulletin: r.bulletin, status: r.status, date: r.date }));
    const rate = netDaysPerMonth(series, 24);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(20);
    expect(rate!).toBeLessThan(30);
  });

  it("projects an arrival month for a step series", () => {
    const p = predictForPerson({ category: "EB2", chargeability: "IN", priorityDate: "2016-01-01" } as never, { rows: stepRows(), uscisChart: {} }, "2026-07-01");
    expect(p.eta).not.toBeNull();
    expect(p.eta!.likely > "2026-06").toBe(true);
  });

  it("measures from the last published cutoff when the category is unavailable", () => {
    const rows = stepRows();
    rows.push({ ...rows.at(-1)!, bulletin: "2026-07", status: "unavailable", date: "" } as BulletinRow);
    const p = predictForPerson({ category: "EB2", chargeability: "IN", priorityDate: "2016-01-01" } as never, { rows, uscisChart: {} }, "2026-07-15");
    expect(p.gapDays).toBeGreaterThan(0);
    expect(p.explanation).toContain("last published final action cutoff");
  });
});
