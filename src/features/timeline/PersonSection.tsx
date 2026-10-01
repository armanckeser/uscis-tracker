import { useState } from "react";
import type { CaseFact, NoticeDetail, PersonRecord, RefreshSummary, CaseRecord } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import { PlaceInLine } from "../prediction/PlaceInLine";
import { ProfileSheet } from "../prediction/ProfileSheet";
import { AddCaseInline } from "./AddCaseInline";
import { CaseCard } from "./CaseCard";
import { HistoryList } from "./HistoryList";
import { GetCasesGuide } from "./GetCasesGuide";

/** The green card case reads first; its companions follow. */
const formRank = (form: string | null) => (/485/.test(form ?? "") ? 0 : 1);

// A person: their name, their place in line, one status card per case, then a
// single combined history. Entries their cases share appear once.
export function PersonSection({
  person,
  people,
  cases,
  trackedReceipts,
  facts,
  noticeDetailsByLetterId,
  busy,
  showToast,
  refresh,
  onAddCase,
  onDeleteCase,
  onOpenSnapshot,
  onOpenConnection,
}: {
  person: PersonRecord;
  people: PersonRecord[];
  cases: CaseRecord[];
  /** Every receipt in the tracker, not just this person's: one bookmark covers them all. */
  trackedReceipts: string[];
  facts: CaseFact[];
  noticeDetailsByLetterId: Map<string, NoticeDetail>;
  busy: string | null;
  showToast: ShowToast;
  refresh: RefreshSummary;
  onAddCase: (personId: string, receiptNumber: string) => Promise<void>;
  onDeleteCase: (caseId: string, receiptNumber: string) => void;
  onOpenSnapshot: (snapshotId: string) => void;
  onOpenConnection: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <section className="person" aria-label={`${person.name}`}>
      <header className="person-header">
        <h2>{person.name}</h2>
        {cases.length > 0 && (
          <AddCaseInline
            personName={person.name}
            busy={busy === `add-case-${person.id}`}
            showToast={showToast}
            onAdd={(receiptNumber) => onAddCase(person.id, receiptNumber)}
          />
        )}
      </header>

      {/* With no cases, getting them in is the one thing to do, so it leads. */}
      {cases.length === 0 && (
        <GetCasesGuide
          personName={person.name}
          receipts={trackedReceipts}
          firstRun={trackedReceipts.length === 0}
          busy={busy === `add-case-${person.id}`}
          showToast={showToast}
          onAddCase={(receiptNumber) => onAddCase(person.id, receiptNumber)}
          onOpenConnection={onOpenConnection}
        />
      )}

      <PlaceInLine person={person} people={people} onEditProfile={() => setProfileOpen(true)} />

      {cases.length > 0 && (
        <>
          {[...cases].sort((a, b) => formRank(a.formType) - formRank(b.formType)).map((caseRecord) => (
            <CaseCard
              key={caseRecord.id}
              caseRecord={caseRecord}
              person={person}
              facts={facts.filter((fact) => fact.caseId === caseRecord.id)}
              busy={busy}
              showToast={showToast}
              refresh={refresh}
              onOpenSnapshot={onOpenSnapshot}
              onDelete={() => onDeleteCase(caseRecord.id, caseRecord.receiptNumber)}
            />
          ))}
          <HistoryList
            cases={cases}
            facts={facts}
            noticeDetailsByLetterId={noticeDetailsByLetterId}
            busy={busy}
            showToast={showToast}
            refresh={refresh}
            onOpenSnapshot={onOpenSnapshot}
            onOpenConnection={onOpenConnection}
          />
        </>
      )}

      {profileOpen && (
        <ProfileSheet person={person} people={people} refresh={refresh} showToast={showToast} onClose={() => setProfileOpen(false)} />
      )}
    </section>
  );
}
