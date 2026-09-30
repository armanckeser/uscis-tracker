import { Database, X } from "lucide-react";
import { formatDateTime } from "../lib/format";
import type { SnapshotResponse } from "../lib/types";
import { Overlay } from "./Overlay";

/** The case clock USCIS stamped on this response, distinct from when we read it. */
function caseClockOf(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const value = (rawData as Record<string, unknown>).updatedAtTimestamp;
  return typeof value === "string" && value.trim() ? value : null;
}

export function RawSnapshotModal({
  snapshot,
  latestSnapshotId,
  onOpenLatest,
  onClose,
}: {
  snapshot: SnapshotResponse["snapshot"];
  /** The newest snapshot on file for this case, when it is known. */
  latestSnapshotId: string | null;
  onOpenLatest: (snapshotId: string) => void;
  onClose: () => void;
}) {
  // Two clocks, both shown. A row's evidence is the snapshot that first recorded
  // it, which is often much older than the newest response on file; printing only
  // "checked <date>" made an old snapshot look like the current state of the case.
  const caseClock = caseClockOf(snapshot.raw_data);

  // Offer the newest response here, where "so where is the newest one?" gets asked.
  const newerOnFile = latestSnapshotId && latestSnapshotId !== snapshot.id ? latestSnapshotId : null;
  return (
    <Overlay variant="modal" labelledBy="raw-title" onClose={onClose} className="modal">
      {(close) => (
        <>
          <div className="modal-header">
            <div>
              <h2 id="raw-title">Raw USCIS response</h2>
              <p className="muted">
                <span className="mono">{snapshot.receipt_number}</span> read {formatDateTime(snapshot.checked_at)}
                {caseClock && <> · USCIS last touched the case {formatDateTime(caseClock)}</>}
              </p>
              {newerOnFile && (
                <button type="button" className="button button-ghost modal-newest" onClick={() => onOpenLatest(newerOnFile)}>
                  <Database size={15} /> Newest response
                </button>
              )}
            </div>
            <button type="button" className="icon-button" onClick={close} aria-label="Close raw response">
              <X size={18} />
            </button>
          </div>
          <pre className="json-block">{JSON.stringify(snapshot.raw_data, null, 2)}</pre>
        </>
      )}
    </Overlay>
  );
}
