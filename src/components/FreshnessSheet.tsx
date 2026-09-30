import { ArrowUpRight, X } from "lucide-react";
import { formatDateTime, relativeFromNow } from "../lib/format";
import { USCIS_ACCOUNT_URL } from "../lib/uscis";
import { Overlay } from "./Overlay";

/** The one place the refresh loop lives: open USCIS, tap the bookmark, come back. */
export function FreshnessSheet({
  lastCheckedAt,
  onOpenConnection,
  onClose,
}: {
  lastCheckedAt: string | null;
  onOpenConnection: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay variant="sheet" labelledBy="fresh-title" onClose={onClose}>
      {(close) => (
        <div className="sheet-body">
          <div className="sheet-head">
            <div>
              <h2 id="fresh-title">{lastCheckedAt ? `Last read ${relativeFromNow(lastCheckedAt)}` : "No reads yet"}</h2>
              {lastCheckedAt && <p className="muted">{formatDateTime(lastCheckedAt)}</p>}
            </div>
            <button type="button" className="icon-button" onClick={close} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <a className="button button-primary button-block" href={USCIS_ACCOUNT_URL} target="_blank" rel="noopener noreferrer" data-autofocus>
            Open USCIS
            <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <p className="muted">Sign in, tap your refresh bookmark, come back. USCIS asks for a code each time, so nothing can check for you.</p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              close();
              onOpenConnection();
            }}
          >
            Set up the bookmark
          </button>
        </div>
      )}
    </Overlay>
  );
}
