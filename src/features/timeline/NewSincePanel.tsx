import { useState } from "react";
import { Loader2 } from "lucide-react";
import { acknowledgeChanges } from "../../lib/api";
import { relativeFromNow } from "../../lib/format";
import { unreadEntries } from "../../lib/unread";
import { formCode, presentEntry } from "../../lib/uscisCopy";
import type { CaseSummary, RefreshSummary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";

const VISIBLE = 4;

// The answer to the app's one question: has anything changed since I looked?
//
// This is the only surface ordered by when WE found out rather than when USCIS
// acted. USCIS stamps a silent update with a date that can be days old, so in
// the history it sits below entries already read. Here it is at the top,
// because it is news.
//
// What counts as unread lives in lib/unread so the refresh report cannot
// disagree with this list.
export function NewSincePanel({
  cases,
  refresh,
  showToast,
}: {
  cases: CaseSummary[];
  refresh: RefreshSummary;
  showToast: ShowToast;
}) {
  const [busy, setBusy] = useState(false);
  const unread = unreadEntries(cases);

  if (unread.length === 0) return null;

  async function handleAcknowledge() {
    setBusy(true);
    try {
      await acknowledgeChanges();
      await refresh(true);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not mark these as read.");
    } finally {
      setBusy(false);
    }
  }

  const shown = unread.slice(0, VISIBLE);
  return (
    <section className="new-since" aria-label="New since you last looked">
      <header className="new-since-head">
        <h2>
          {unread.length} {unread.length === 1 ? "change" : "changes"} since you last looked
        </h2>
        <button className="text-button" type="button" onClick={() => void handleAcknowledge()} disabled={busy}>
          {busy && <Loader2 className="spin" size={14} />}
          Acknowledge
        </button>
      </header>

      <ol className="new-since-list">
        {shown.map(({ entry, caseRecord }) => (
          <li key={entry.id}>
            <span>
              <strong>{presentEntry(entry).title}</strong>
              <span className="muted">
                {" "}
                · {caseRecord.personName} · {formCode(caseRecord.formType)}
              </span>
            </span>
            <span className="muted">found {relativeFromNow(entry.entries[entry.entries.length - 1]?.firstSeenAt)}</span>
          </li>
        ))}
      </ol>
      {unread.length > VISIBLE && <p className="label muted">and {unread.length - VISIBLE} more</p>}
    </section>
  );
}
