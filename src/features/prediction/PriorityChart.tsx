import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDay, formatMonth } from "../../../shared/predict";
import type { BulletinHistory, PersonPrediction } from "../../lib/types";
import { buildChartModel, CHART_HEIGHT, nearestPoint, type ChartPoint } from "./chartMath";

// The line draws in once per session, per chart. Module state, not component
// state: a re-render or a remount (switching tabs and back) must never replay it.
const drawn = new Set<string>();

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width) || fallback));
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return { ref, width };
}

function readout(point: ChartPoint): string {
  const value = point.status === "date" && point.date ? formatDay(point.date) : point.status === "current" ? "Current" : "Unavailable";
  return `${formatMonth(point.bulletin)} bulletin · ${value}`;
}

const TOOLTIP_HALF = 104;

/**
 * The cutoff over the last 36 bulletins as a step line, the person's priority
 * date as a dashed line, the gap between them shaded, and the projected arrival
 * as a fan. Hand-rolled SVG: two lines and two shapes do not need a library.
 */
export function PriorityChart({
  history,
  priorityDate,
  prediction,
  drawKey,
}: {
  history: BulletinHistory;
  priorityDate: string;
  prediction: Pick<PersonPrediction, "eta" | "isCurrent">;
  drawKey: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(320);
  const clipId = useId();
  const model = useMemo(() => buildChartModel({ history, priorityDate, prediction, width }), [history, priorityDate, prediction, width]);
  const [active, setActive] = useState<number | null>(null);
  const [animate] = useState(() => !drawn.has(drawKey));

  useEffect(() => {
    drawn.add(drawKey);
  }, [drawKey]);

  if (!model) return null;
  const { plot, points, pdY, lastPoint } = model;
  const activePoint = active !== null ? points[active] : null;
  // Above the dashed line by default; below it once the cutoff has passed the date.
  const labelBelow = lastPoint?.y != null && lastPoint.y < pdY;

  function scrub(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setActive(nearestPoint(points, event.clientX - rect.left));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    setActive((current) => {
      const at = current ?? points.length - 1;
      if (event.key === "Home") return 0;
      if (event.key === "End") return points.length - 1;
      return Math.max(0, Math.min(points.length - 1, at + (event.key === "ArrowRight" ? 1 : -1)));
    });
  }

  const first = points[0];
  const summaryLabel = `Final action cutoff over the last ${points.length} bulletins, from ${readout(first)} to ${readout(points[points.length - 1])}. Your priority date is ${formatDay(priorityDate)}. Use the arrow keys to read each bulletin.`;

  return (
    <div className="chart" ref={ref}>
      <div
        className="chart-hit"
        tabIndex={0}
        role="group"
        aria-label={summaryLabel}
        onPointerMove={scrub}
        onPointerDown={scrub}
        onPointerLeave={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg width={model.width} height={CHART_HEIGHT} viewBox={`0 0 ${model.width} ${CHART_HEIGHT}`} aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <rect x={plot.left} y={plot.top - 2} width={plot.right - plot.left + 1} height={plot.bottom - plot.top + 4} />
            </clipPath>
          </defs>

          {model.yTicks.map((tick) => (
            <g key={`y${tick.label}`}>
              <line className="chart-grid" x1={plot.left} x2={plot.right} y1={tick.pos} y2={tick.pos} />
              <text className="chart-tick" x={plot.left - 8} y={tick.pos} textAnchor="end" dominantBaseline="middle">
                {tick.label}
              </text>
            </g>
          ))}
          {model.xTicks.map((tick) => (
            <text key={`x${tick.label}`} className="chart-tick" x={tick.pos} y={CHART_HEIGHT - 5} textAnchor="middle">
              {tick.label}
            </text>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {model.gapPaths.map((d, i) => (
              <path key={i} className="chart-gap" d={d} />
            ))}
            {model.fan && (
              <>
                <path className="chart-fan" d={model.fan.area} />
                <path className="chart-likely" d={model.fan.likely} />
              </>
            )}
          </g>

          <line className="chart-pd" x1={plot.left} x2={plot.right} y1={pdY} y2={pdY} />
          <text className="chart-label" x={plot.left + 4} y={labelBelow ? pdY + 14 : pdY - 6}>
            Your date
          </text>

          {model.linePaths.map((d, i) => (
            <path key={i} className={`chart-line ${animate ? "is-drawing" : ""}`} d={d} pathLength={1} />
          ))}

          {lastPoint && lastPoint.y !== null && (
            <text className="chart-label" x={lastPoint.x + 8} y={lastPoint.y + 18} textAnchor="start">
              Cutoff
            </text>
          )}
          {lastPoint && lastPoint.y !== null && <circle className="chart-dot" cx={lastPoint.x} cy={lastPoint.y} r={4} />}

          {activePoint && activePoint.y !== null && (
            <g>
              <line className="chart-rule" x1={activePoint.x} x2={activePoint.x} y1={plot.top} y2={plot.bottom} />
              <circle className="chart-dot" cx={activePoint.x} cy={activePoint.y} r={4} />
            </g>
          )}
        </svg>

        {activePoint && (
          <div
            className="chart-tooltip"
            style={{ left: Math.max(TOOLTIP_HALF, Math.min(model.width - TOOLTIP_HALF, activePoint.x)) }}
            aria-live="polite"
          >
            {readout(activePoint)}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Final action cutoff by bulletin</caption>
        <thead>
          <tr>
            <th>Bulletin</th>
            <th>Cutoff</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.bulletin}>
              <td>{formatMonth(point.bulletin)}</td>
              <td>{point.status === "date" && point.date ? formatDay(point.date) : point.status === "current" ? "Current" : "Unavailable"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
