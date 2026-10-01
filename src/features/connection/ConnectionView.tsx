import { FormEvent, useState } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import { addPerson } from "../../lib/api";
import type { RefreshSummary, Summary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import type { PushState } from "../../hooks/usePush";
import { EmptyState } from "../../components/EmptyState";
import { PersonRefreshCard } from "./PersonRefreshCard";
import { RefreshPanel } from "./RefreshPanel";
import { NotificationPanel } from "./NotificationPanel";
import { ImportPanel } from "./ImportPanel";
import { LocalDataPanel } from "./LocalDataPanel";
import { LOCAL_MODE } from "../../lib/mode";

// Secondary screen: the refresh tools per person, notifications, and manual
// import. The daily flow lives on the timeline.
export function ConnectionView({
  summary,
  refresh,
  showToast,
  pushState,
  pushBusy,
  onTogglePush,
}: {
  summary: Summary | null;
  refresh: RefreshSummary;
  showToast: ShowToast;
  pushState: PushState;
  pushBusy: boolean;
  onTogglePush: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const people = summary?.people ?? [];
  const cases = summary?.cases ?? [];

  function handleAddPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const name = String(new FormData(formEl).get("name") ?? "").trim();
    if (!name) return;
    formEl.reset();

    void (async () => {
      setBusy("add-person");
      try {
        await addPerson({ name });
        showToast("success", `${name} was added.`);
        await refresh(true);
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Could not add person.");
      } finally {
        setBusy(null);
      }
    })();
  }

  return (
    <div className="view-stack">
      <header className="page-header">
        <h1>Connection</h1>
        <p className="muted">How case data gets in, and who it belongs to.</p>
      </header>

      <RefreshPanel cases={cases} showToast={showToast} />

      <section className="section-panel connection-panel">
        <div className="connection-lede">
          <div>
            <h2>People and cases</h2>
            <p>Each USCIS account holder owns their own receipts.</p>
          </div>
        </div>

        <div className="person-session-list">
          {people.length === 0 ? (
            <EmptyState body="Add each USCIS account holder. Their cases come in when they refresh." icon={<Users size={22} />} />
          ) : (
            people.map((person) => (
              <PersonRefreshCard
                key={person.id}
                person={person}
                personCases={cases.filter((caseRecord) => caseRecord.personId === person.id)}
              />
            ))
          )}
        </div>

        <form className="add-person-form" onSubmit={handleAddPerson}>
          <label>
            Add person
            <input name="name" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" placeholder="Name" />
          </label>
          <button className="button button-secondary" type="submit" disabled={busy === "add-person"}>
            {busy === "add-person" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Add person
          </button>
        </form>
      </section>

      {LOCAL_MODE ? (
        <LocalDataPanel summary={summary} refresh={refresh} showToast={showToast} />
      ) : (
        <NotificationPanel summary={summary} pushState={pushState} pushBusy={pushBusy} onToggle={onTogglePush} />
      )}
      <ImportPanel summary={summary} refresh={refresh} showToast={showToast} />
    </div>
  );
}
