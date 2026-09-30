import { ArrowUpRight } from "lucide-react";
import { USCIS_ACCOUNT_URL } from "../../lib/uscis";
import { buildImportFallbackBookmarklet, buildRefreshBookmarklet, buildShortcutScript } from "../../lib/bookmarklet";
import type { CaseRecord } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import { BookmarkletRow } from "./BookmarkletRow";
import { ScriptBlock } from "./ScriptBlock";

// The refresh setup, done once. One bookmark covers every tracked case for both
// people: the import endpoint works out whose case a response is from, so the
// script carries no identity and does not need to know which account it is
// running in. Cases belonging to the other account are simply counted as denied.
export function RefreshPanel({
  cases,
  showToast,
}: {
  cases: CaseRecord[];
  showToast: ShowToast;
}) {
  const receipts = cases.map((caseRecord) => caseRecord.receiptNumber);

  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <h2>Refreshing</h2>
          <p>
            USCIS asks for a one-time code every time you sign in, so nothing can check your cases on a schedule. A refresh
            has to run inside a browser that is already signed in. Save this bookmark once and it becomes one tap for every
            case.
          </p>
        </div>
      </div>

      <ol className="refresh-steps">
        <li>
          Save <strong>Refresh cases</strong> below as a bookmark. On desktop, drag it to the bookmarks bar. On a phone,
          copy it and paste it as the address of a new bookmark.
        </li>
        <li>
          <a className="inline-link" href={USCIS_ACCOUNT_URL} target="_blank" rel="noreferrer">
            Sign in to myUSCIS <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </li>
        <li>Tap the bookmark. It reads every case that account can see and brings you back here with the result.</li>
      </ol>

      <BookmarkletRow
        label="Refresh cases"
        hint={
          receipts.length === 0
            ? "Add a case first — the bookmark covers whatever is tracked when you copy it."
            : `Covers ${receipts.length} ${receipts.length === 1 ? "case" : "cases"}. Copy it again after adding a case.`
        }
        code={buildRefreshBookmarklet({ trackerOrigin: window.location.origin, receipts })}
        showToast={showToast}
      />

      <details className="phone-refresh">
        <summary>Set this up as an iPhone Shortcut instead</summary>
        <p className="field-help">
          A Shortcut runs from Safari's share sheet, which is a real gesture instead of typing a bookmark name into the
          address bar. Same mechanism underneath. Set up once:
        </p>
        <ol className="refresh-steps">
          <li>
            Turn on <strong>Settings → Shortcuts → Advanced → Allow Running Scripts</strong>.
          </li>
          <li>
            In Shortcuts, create a shortcut, add the <strong>Run JavaScript on Webpage</strong> action, and replace its
            contents with the script below.
          </li>
          <li>
            In that shortcut's details, turn on <strong>Show in Share Sheet</strong> and set it to accept{" "}
            <strong>Safari web pages</strong>. It only works from the share sheet — there is no way to run it against the
            frontmost tab from the Home Screen.
          </li>
          <li>
            On a signed-in myUSCIS page, tap Share and pick the shortcut. Approve the privacy prompt the first time.
          </li>
        </ol>
        <ScriptBlock code={buildShortcutScript({ trackerOrigin: window.location.origin, receipts })} showToast={showToast} />
        <p className="field-help">
          Steps verified against Apple's documented behaviour for that action, but Shortcuts changes between iOS releases —
          if it hangs instead of reporting a count, check that the script still ends with the <code>completion(...)</code>
          call. See <code>docs/ios-shortcut.md</code>.
        </p>
      </details>

      <details className="phone-refresh">
        <summary>If refreshing opens a page of raw data</summary>
        <p className="field-help">
          On iPhone, a background read is sometimes refused even though you are signed in. The bookmark then opens the case
          data as a plain page instead. Tap <strong>Import this page</strong> there to finish, and save that as a second
          bookmark now.
        </p>
        <BookmarkletRow
          label="Import this page"
          hint="Only needed on a raw case data page. It reads what the page is showing and sends it here."
          code={buildImportFallbackBookmarklet(window.location.origin)}
          showToast={showToast}
        />
      </details>
    </section>
  );
}
