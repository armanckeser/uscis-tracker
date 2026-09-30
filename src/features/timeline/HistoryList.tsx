import { useMemo, useState } from "react";
import { ChevronRight, FileJson, Loader2 } from "lucide-react";
import { lookupNotice } from "../../../shared/lifecycle";
import { EmptyState } from "../../components/EmptyState";
import { buildHistory, mergeSharedEntries, type HistoryBlock, type HistoryEntry } from "../../lib/history";
import { formatSmartDay } from "../../lib/format";
import { formCode, presentEntry, toneForTag } from "../../lib/uscisCopy";
import type { CaseFact, CaseRecord, NoticeDetail, RefreshSummary, TimelineEntry } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import { AppointmentOutcome } from "./AppointmentOutcome";
import { NoticeDetailEditor } from "./NoticeDetailEditor";

type Shared = {
  caseById: Map<string, CaseRecord>;
  multiCase: boolean;
  facts: CaseFact[];
  noticeDetailsByLetterId: Map<string, NoticeDetail>;
  busy: string | null;
  showToast: ShowToast;
  refresh: RefreshSummary;
  onOpenSnapshot: (snapshotId: string) => void;
};

function markerTone(entry: TimelineEntry): string {
  if (entry.tone === "good") return "good";
  if (entry.tone === "bad") return "bad";
  const tone = toneForTag(presentEntry(entry).tag);
  return tone === "forward" || entry.tone === "action" ? "forward" : "plain";
}

function CaseChips({ item, shared }: { item: HistoryEntry; shared: Shared }) {
  if (!shared.multiCase) return null;
  const forms = item.caseIds.map((id) => formCode(shared.caseById.get(id)?.formType ?? null));
  return <span className="chip chip-plain">{forms.join(" · ")}</span>;
}

/** One Evidence button per case that holds the entry: the raw snapshot that first recorded it. */
function EvidenceButtons({ item, shared }: { item: HistoryEntry; shared: Shared }) {
  return (
    <>
      {item.members.map((member) => {
        const snapshotId = member.entries[0]?.snapshotId;
        if (!snapshotId) return null;
        const form = shared.multiCase ? ` · ${formCode(shared.caseById.get(member.caseId)?.formType ?? null)}` : "";
        return (
          <button
            key={member.id}
            type="button"
            className="button button-ghost"
            onClick={() => shared.onOpenSnapshot(snapshotId)}
            disabled={shared.busy === snapshotId}
          >
            {shared.busy === snapshotId ? <Loader2 className="spin" size={15} /> : <FileJson size={15} />}
            Evidence{form}
          </button>
        );
      })}
    </>
  );
}

function HistoryRow({ item, shared, defaultOpen = false }: { item: HistoryEntry; shared: Shared; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { entry } = item;
  const shown = presentEntry(entry);
  const detailId = `history-${item.key}`;
  const tone = markerTone(entry);

  return (
    <li className={`history-row ${open ? "is-open" : ""}`} data-tone={tone}>
      <button type="button" className="history-toggle pressable" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((v) => !v)}>
        <span className="history-marker" aria-hidden="true" />
        <span className="history-main">
          <span className="history-title">
            {shown.title}
            {entry.count > 1 && <span className="muted"> ×{entry.count}</span>}
          </span>
          <CaseChips item={item} shared={shared} />
        </span>
        <span className="history-date muted">{formatSmartDay(entry.occurredOn)}</span>
        <ChevronRight className="chevron" size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className="history-detail reveal" id={detailId}>
          <p>{shown.meaning}</p>
          {item.members.map((member) => (
            <MemberDetail key={member.id} member={member} labelled={item.members.length > 1} shared={shared} />
          ))}
          <div className="button-row">
            <EvidenceButtons item={item} shared={shared} />
          </div>
        </div>
      )}
    </li>
  );
}

/** Appointment answers and fill-in notice details belong to a case's own notice, so each member gets its own. */
function MemberDetail({ member, labelled, shared }: { member: TimelineEntry; labelled: boolean; shared: Shared }) {
  const notice = member.kind === "notice" ? lookupNotice(member.code) : null;
  const caseRecord = shared.caseById.get(member.caseId);
  const fact = member.letterId ? shared.facts.find((f) => f.letterId === member.letterId) ?? null : null;
  const passed = member.appointmentAt ? Date.parse(member.appointmentAt) < Date.now() : false;
  const saved = member.letterId ? shared.noticeDetailsByLetterId.get(member.letterId)?.details ?? {} : {};
  const hasEditor = Boolean(notice && (notice.fillable?.length || notice.isAppointment));
  if (!hasEditor && !(member.appointmentAt && passed)) return null;

  return (
    <div className="member-detail">
      {labelled && <p className="label muted">{formCode(caseRecord?.formType ?? null)}</p>}
      {member.appointmentAt && passed && (
        <AppointmentOutcome
          caseId={member.caseId}
          letterId={member.letterId}
          appointmentIso={member.appointmentAt}
          fact={fact}
          showToast={shared.showToast}
          onSaved={async () => void (await shared.refresh(true))}
        />
      )}
      {notice && hasEditor && (
        <NoticeDetailEditor
          entry={notice}
          letterId={member.letterId}
          appointmentIso={member.appointmentAt}
          savedDetails={saved}
          showToast={shared.showToast}
          onSaved={async () => void (await shared.refresh(true))}
        />
      )}
    </div>
  );
}

function QuietRow({ block, shared }: { block: Extract<HistoryBlock, { type: "quiet" }>; shared: Shared }) {
  const [open, setOpen] = useState(false);
  const range = block.from === block.to ? formatSmartDay(block.from) : `${formatSmartDay(block.from)} – ${formatSmartDay(block.to)}`;
  const label = `${block.count} quiet ${block.count === 1 ? "update" : "updates"}`;
  return (
    <li className={`history-row history-quiet ${open ? "is-open" : ""}`}>
      <button type="button" className="history-toggle pressable" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="history-marker" aria-hidden="true" />
        <span className="history-main">
          <span className="history-title muted">
            {label} <span aria-hidden="true">·</span> {range}
          </span>
        </span>
        <ChevronRight className="chevron" size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className="quiet-list reveal">
          {block.items.map((item) => (
            <li key={item.key}>
              <span>
                {presentEntry(item.entry).title}
                {item.entry.count > 1 && ` ×${item.entry.count}`}
                <CaseChips item={item} shared={shared} />
              </span>
              <span className="muted">{formatSmartDay(item.entry.occurredOn)}</span>
              <EvidenceButtons item={item} shared={shared} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A person's history: the three newest meaningful entries, with the rest and
 * the quiet runs one tap away. Entries two of their cases share appear once,
 * naming both cases.
 */
export function HistoryList({
  cases,
  facts,
  noticeDetailsByLetterId,
  busy,
  showToast,
  refresh,
  onOpenSnapshot,
  onOpenConnection,
}: {
  cases: CaseRecord[];
  facts: CaseFact[];
  noticeDetailsByLetterId: Map<string, NoticeDetail>;
  busy: string | null;
  showToast: ShowToast;
  refresh: RefreshSummary;
  onOpenSnapshot: (snapshotId: string) => void;
  onOpenConnection: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const merged = useMemo(() => mergeSharedEntries(cases), [cases]);
  const history = useMemo(() => buildHistory(merged), [merged]);
  const shared: Shared = {
    caseById: new Map(cases.map((c) => [c.id, c])),
    multiCase: cases.length > 1,
    facts,
    noticeDetailsByLetterId,
    busy,
    showToast,
    refresh,
    onOpenSnapshot,
  };

  if (history.total === 0) {
    return (
      <EmptyState
        body="No movement recorded yet. Refresh from USCIS to read the first snapshot."
        action={
          <button type="button" className="button button-soft" onClick={onOpenConnection}>
            Set up refresh
          </button>
        }
      />
    );
  }

  const canExpand = history.total > history.preview.length;
  return (
    <section className="history" aria-label="History">
      <h3 className="label">History</h3>
      <ol className="history-list">
        {showAll
          ? history.blocks.map((block) =>
              block.type === "entry" ? (
                <HistoryRow key={block.item.key} item={block.item} shared={shared} />
              ) : (
                <QuietRow key={`q-${block.items[0].key}`} block={block} shared={shared} />
              ),
            )
          : history.preview.map((item) => <HistoryRow key={item.key} item={item} shared={shared} />)}
      </ol>
      {canExpand && (
        <button type="button" className="text-button history-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show full history (${history.total})`}
        </button>
      )}
    </section>
  );
}
