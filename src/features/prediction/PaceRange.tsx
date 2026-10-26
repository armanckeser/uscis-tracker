import { CalendarClock, TrendingUp } from "lucide-react";
import { formatMonth } from "../../../shared/predict";
import type { PersonPrediction } from "../../lib/types";
import { magnitude } from "./predictionCopy";

/**
 * How the estimate was reached, as numbers and a track instead of a paragraph:
 * the gap to the cutoff, how fast the cutoff moves, and the faster, likely and
 * slower arrival months.
 */
export function PaceRange({ prediction }: { prediction: PersonPrediction }) {
  const { eta, gapDays } = prediction;
  if (!eta) return null;

  const retrogressions = prediction.movement.find((w) => w.months === 24)?.retrogressions ?? 0;
  const stops = [
    { key: "fast", label: "Faster", month: eta.optimistic },
    { key: "likely", label: "Likely", month: eta.likely },
    { key: "slow", label: "Slower", month: eta.conservative },
  ].filter((s, i, all) => i === 1 || s.month === null || s.month !== all[1].month);

  return (
    <div className="pace">
      <dl className="pace-facts">
        {gapDays !== null && gapDays > 0 && (
          <div>
            <dt>
              <CalendarClock size={16} aria-hidden="true" /> Behind cutoff
            </dt>
            <dd>{magnitude(gapDays)}</dd>
          </div>
        )}
        <div>
          <dt>
            <TrendingUp size={16} aria-hidden="true" /> Cutoff pace
          </dt>
          <dd>
            +{Math.round(eta.basis.daysPerMonth.median)} days a month
            {retrogressions > 0 && <span className="pace-setback"> · {retrogressions} setback{retrogressions === 1 ? "" : "s"}</span>}
          </dd>
        </div>
      </dl>

      <ol className="pace-range" aria-label="When your date could be reached">
        {stops.map((s) => (
          <li key={s.key} className={`pace-stop pace-${s.key}`}>
            <span className="pace-dot" aria-hidden="true" />
            <span className="pace-label">{s.label}</span>
            <span className="pace-month">{s.month ? formatMonth(s.month) : "Not projected"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
