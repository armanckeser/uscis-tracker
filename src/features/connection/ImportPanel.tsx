import { FormEvent, useState } from "react";
import { FileJson, Loader2 } from "lucide-react";
import { importSnapshot } from "../../lib/api";
import type { RefreshSummary, Summary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import { PersonSelect } from "../../components/PersonSelect";

// Manual JSON import. This is the reliable path: paste a USCIS response (or let
// the bookmarklet POST it) and the server stores + diffs it. Lives in a
// collapsed details section because it is recovery tooling, not the daily flow.
export function ImportPanel({
  summary,
  refresh,
  showToast,
}: {
  summary: Summary | null;
  refresh: RefreshSummary;
  showToast: ShowToast;
}) {
  const people = summary?.people ?? [];
  const [busy, setBusy] = useState(false);

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const rawText = String(form.get("raw") ?? "").trim();
    // The receipt number inside the response identifies the case, and a tracked
    // case already knows its owner, so the person picker is only a fallback for
    // a receipt the tracker has never seen. The server decides.
    const personId = String(form.get("personId") ?? "").trim() || undefined;
    if (!rawText) return;

    let raw: unknown;
    try {
      raw = JSON.parse(rawText);
    } catch {
      showToast("error", "JSON is not valid. Copy the entire USCIS API response and try again.");
      return;
    }

    setBusy(true);
    try {
      const result = await importSnapshot({ raw, personId });
      formEl.reset();
      if (result.outcome === "unchanged") {
        showToast("info", "USCIS returned the response already on file. Nothing new.");
      } else {
        const count = result.changes.length;
        showToast("success", count === 1 ? "Imported. 1 new change." : `Imported. ${count} new changes.`);
      }
      await refresh(true);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not import snapshot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-panel recovery-panel">
      <details>
        <summary>
          <span>Manual import</span>
          <small>Paste a USCIS response to store and diff it</small>
        </summary>
        <form className="import-form" onSubmit={handleImport}>
          <label>
            Person <span className="label-note">only for a receipt not tracked yet</span>
            <PersonSelect people={people} name="personId" />
          </label>
          <label>
            USCIS JSON
            <textarea name="raw" rows={8} placeholder='Paste {"data": ...} from the USCIS case API page' />
          </label>
          <button className="button button-secondary" type="submit" disabled={busy || people.length === 0}>
            {busy ? <Loader2 className="spin" size={16} /> : <FileJson size={16} />}
            Import snapshot
          </button>
          {people.length === 0 && <p className="form-hint">Add a person before importing a snapshot.</p>}
        </form>
      </details>
    </section>
  );
}
