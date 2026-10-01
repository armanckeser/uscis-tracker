import { useMemo } from "react";
import type { RefreshSummary, Summary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import { EmptyState } from "../../components/EmptyState";
import { NewSincePanel } from "./NewSincePanel";
import { PersonSection } from "./PersonSection";
import { AddPersonInline } from "./AddPersonInline";
import { useCaseActions } from "./useCaseActions";
import { LOCAL_MODE } from "../../lib/mode";

// The home page: what changed, then per person their place in line, a status
// card per case, and one combined history.
export function TimelineView({
  summary,
  showToast,
  refresh,
  onOpenSnapshot,
  onOpenConnection,
}: {
  summary: Summary;
  showToast: ShowToast;
  refresh: RefreshSummary;
  onOpenSnapshot: (snapshotId: string) => Promise<void>;
  onOpenConnection: () => void;
}) {
  const { busy, setBusy, addCaseForPerson, addNewPerson, removeCase } = useCaseActions({
    people: summary.people,
    refresh,
    showToast,
  });

  // Principals first, so a derivative's card reads after the person they inherit from.
  const people = useMemo(
    () => [...summary.people].sort((a, b) => Number(Boolean(a.profile.principalPersonId)) - Number(Boolean(b.profile.principalPersonId))),
    [summary.people],
  );

  const noticeDetailsByLetterId = useMemo(() => {
    const map = new Map<string, (typeof summary.noticeDetails)[number]>();
    for (const detail of summary.noticeDetails) map.set(detail.letterId, detail);
    return map;
  }, [summary.noticeDetails]);

  async function handleOpenSnapshot(snapshotId: string) {
    setBusy(snapshotId);
    try {
      await onOpenSnapshot(snapshotId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="timeline-view">
      <NewSincePanel cases={summary.cases} refresh={refresh} showToast={showToast} />

      {summary.people.length === 0 && (
        <EmptyState
          body={
            LOCAL_MODE
              ? "Each USCIS account holder gets their own timeline. Add the first person, then their receipts. It all stays in this browser: nothing is uploaded."
              : "Each USCIS account holder gets their own timeline. Add the first person, then their receipts."
          }
          action={<AddPersonInline busy={busy === "add-person"} showToast={showToast} onAdd={addNewPerson} defaultOpen />}
        />
      )}

      {people.map((person) => (
        <PersonSection
          key={person.id}
          person={person}
          people={summary.people}
          cases={summary.cases.filter((caseRecord) => caseRecord.personId === person.id)}
          facts={summary.facts}
          noticeDetailsByLetterId={noticeDetailsByLetterId}
          busy={busy}
          showToast={showToast}
          refresh={refresh}
          onAddCase={addCaseForPerson}
          onDeleteCase={removeCase}
          onOpenSnapshot={handleOpenSnapshot}
          onOpenConnection={onOpenConnection}
        />
      ))}

      {summary.people.length > 0 && (
        <AddPersonInline busy={busy === "add-person"} showToast={showToast} onAdd={addNewPerson} />
      )}

      {LOCAL_MODE && summary.people.length > 0 && (
        <p className="local-note">
          Stored only in this browser. Nothing is uploaded.{" "}
          <button type="button" className="text-button" onClick={onOpenConnection}>
            Back up
          </button>
        </p>
      )}
    </div>
  );
}
