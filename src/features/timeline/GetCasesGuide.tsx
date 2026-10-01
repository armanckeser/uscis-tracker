import { ArrowUpRight } from "lucide-react";
import { buildRefreshBookmarklet } from "../../lib/bookmarklet";
import { LOCAL_MODE, isStandalone } from "../../lib/mode";
import { USCIS_ACCOUNT_URL } from "../../lib/uscis";
import type { ShowToast } from "../../hooks/useToast";
import { BookmarkletRow } from "../connection/BookmarkletRow";
import { refreshTarget } from "../connection/refreshTarget";
import { AddCaseInline } from "./AddCaseInline";

// What a person with no cases sees. The cases are not typed in: the refresh
// bookmark finds them on the signed-in account, so the first thing to do is save
// it and run it. Typing a receipt number is still there, as the way round.
//
// The full walkthrough is for a tracker with no cases at all. Once anyone's
// cases are in, the bookmark has been saved, and the next person only needs to
// be told to sign in as themselves.
export function GetCasesGuide({
  personName,
  receipts,
  firstRun,
  busy,
  showToast,
  onAddCase,
  onOpenConnection,
}: {
  personName: string;
  /** Every receipt tracked, for the bookmark to cover. */
  receipts: string[];
  /** Nothing is tracked yet, so the bookmark has not been saved either. */
  firstRun: boolean;
  busy: boolean;
  showToast: ShowToast;
  onAddCase: (receiptNumber: string) => Promise<void>;
  onOpenConnection: () => void;
}) {
  const signIn = (
    <a className="inline-link" href={USCIS_ACCOUNT_URL} target="_blank" rel="noreferrer">
      Sign in to myUSCIS <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
  const byHand = (
    <AddCaseInline personName={personName} busy={busy} showToast={showToast} onAdd={onAddCase} triggerLabel="Enter a receipt number instead" />
  );

  if (!firstRun) {
    return (
      <div className="get-cases">
        <p>
          No cases for {personName} yet. {signIn} as {personName}, then tap <strong>Refresh cases</strong> on the page that
          lists their cases. They come back here on their own.
        </p>
        <div className="get-cases-alt">
          <button type="button" className="text-button" onClick={onOpenConnection}>
            Get the bookmark
          </button>
          {byHand}
        </div>
      </div>
    );
  }

  return (
    <div className="get-cases">
      <div>
        <h3>Bring in {personName}'s cases</h3>
        <p>
          USCIS only shows a case to a browser that is signed in, so the tracker reads them from there. There is nothing to
          type.{LOCAL_MODE && " The cases go straight into this browser, not to a server."}
        </p>
      </div>

      {LOCAL_MODE && isStandalone() && (
        <p className="callout">
          You opened this from the Home Screen. On iPhone that copy keeps its own storage, so a refresh run in Safari will
          not show up here. Use the tracker in Safari instead.
        </p>
      )}

      <ol className="refresh-steps">
        <li>
          Save <strong>Refresh cases</strong> as a bookmark. On desktop, drag it to the bookmarks bar. On a phone, copy it
          and paste it as the address of a new bookmark.
          <BookmarkletRow
            label="Refresh cases"
            hint="Save it once. It finds the cases on whichever account is signed in."
            code={buildRefreshBookmarklet({ ...refreshTarget(), receipts })}
            showToast={showToast}
          />
        </li>
        <li>{signIn} as {personName}.</li>
        <li>
          On the page that lists your cases, tap the bookmark. It brings you back here with {personName}'s cases and their
          history.
        </li>
      </ol>

      <div className="get-cases-alt">
        <button type="button" className="text-button" onClick={onOpenConnection}>
          Use an iPhone Shortcut instead
        </button>
        {byHand}
      </div>
    </div>
  );
}
