import type { Stage } from "../../lib/types";
import { STAGE_COPY, STAGE_ORDER } from "../../lib/uscisCopy";

/**
 * Seven slim segments, filed to card. Done is ink, the current stage is the one
 * lime mark on the card (with a slow pulse), what is left is a raised surface.
 */
export function StageBar({ stage }: { stage: Stage }) {
  const current = STAGE_ORDER.indexOf(stage);
  return (
    <div className="stage-bar" role="img" aria-label={`Stage ${current + 1} of ${STAGE_ORDER.length}: ${STAGE_COPY[stage].label}`}>
      {STAGE_ORDER.map((step, index) => (
        <span key={step} className={index < current ? "is-done" : index === current ? "is-current" : ""} />
      ))}
    </div>
  );
}
