import { useState } from "react";
import { ArrowUpRight, Check, Database, Info, Loader2, Trash2 } from "lucide-react";
import { easternDate } from "../../../shared/dates";
import { formatSmartDay, formatTimeEt, plural } from "../../lib/format";
import { uscisCaseApiUrl } from "../../lib/uscis";
import { STAGE_ORDER, currentStatus, formLabel, latestAppointment } from "../../lib/uscisCopy";
import type { CaseFact, CaseRecord, PersonRecord, RefreshSummary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import { AppointmentOutcome } from "./AppointmentOutcome";
import { StageBar } from "./StageBar";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

/** "Nov – Feb". Years appear only when the window leaves this year and the next. */
export function windowLabel(from: string, to: string, now = new Date()): string {
  const year = now.getUTCFullYear();
  const [fy, ty] = [Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  const short = (date: string) => MONTH.format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
  const showYears = fy < year || ty > year + 1;
  const label = (date: string, y: number) => (showYears ? `${short(date)} ${y}` : short(date));
  return `${label(from, fy)} – ${label(to, ty)}`;
}

function daysAgo(days: number | null): string | null {
  if (days === null) return null;
  return days === 0 ? "today" : `${plural(days, "day")} ago`;
}

/** The lime-soft callout: what the person has to do or has just done. */
function NextStep({
  caseRecord,
  facts,
  refresh,
  showToast,
}: {
  caseRecord: CaseRecord;
  facts: CaseFact[];
  refresh: RefreshSummary;
  showToast: ShowToast;
}) {
  const { stage } = caseRecord;
  const appointment = latestAppointment(caseRecord.timeline);
  const today = easternDate(new Date().toISOString());

  if (appointment?.appointmentAt) {
    const day = easternDate(appointment.appointmentAt);
    const fact = facts.find((f) => f.letterId && f.letterId === appointment.letterId) ?? null;
    const past = day < today;
    // Once the case has moved past review, an answered appointment is history, not a next step.
    const early = STAGE_ORDER.indexOf(stage.stage) <= STAGE_ORDER.indexOf("review");
    const recent = early || (Date.parse(today) - Date.parse(day)) / 86_400_000 <= 60;
    const kind = appointment.tag === "interview" ? "Interview" : "Biometrics appointment";
    // An open question always shows; an answered one only while it is recent.
    if (!past || !fact || recent) {
      return (
        <div className="callout">
          <p>
            <strong>{kind}</strong>
            <span> · {formatSmartDay(day)}</span>
            {!past && <span> · {formatTimeEt(appointment.appointmentAt)}</span>}
            {fact && (
              <span className="callout-outcome">
                {" "}
                · {fact.kind === "appointment_attended" ? "Attended" : "Missed"}
                {fact.kind === "appointment_attended" && <Check size={14} aria-hidden="true" />}
              </span>
            )}
          </p>
          {past && (
            <AppointmentOutcome
              compact
              caseId={caseRecord.id}
              letterId={appointment.letterId}
              appointmentIso={appointment.appointmentAt}
              fact={fact}
              showToast={showToast}
              onSaved={async () => void (await refresh(true))}
            />
          )}
        </div>
      );
    }
  }

  if (stage.waitingOn === "you" && stage.nextStep) {
    return (
      <div className="callout">
        <p>{stage.nextStep.label}</p>
      </div>
    );
  }
  return null;
}

/** "USCIS processing times for I-765 (Texas), snapshot Sep 22". */
function basisText(caseRecord: CaseRecord): string | null {
  const window = caseRecord.expectation.window;
  if (!window) return null;
  const form = caseRecord.formType ?? "this form";
  const where = window.office ? ` at ${window.office}` : "";
  const base = `USCIS processing times for ${form}${where}, snapshot ${formatSmartDay(window.snapshotDate)}`;
  return window.basis === "visa_availability_plus_processing_times" ? `${base}, counted from when your date becomes current` : base;
}

export function CaseCard({
  caseRecord,
  person,
  facts,
  busy,
  showToast,
  refresh,
  onOpenSnapshot,
  onDelete,
}: {
  caseRecord: CaseRecord;
  person: PersonRecord;
  facts: CaseFact[];
  busy: string | null;
  showToast: ShowToast;
  refresh: RefreshSummary;
  onOpenSnapshot: (snapshotId: string) => void;
  onDelete: () => void;
}) {
  const [basisOpen, setBasisOpen] = useState(false);
  const status = currentStatus(caseRecord);
  const { expectation, stage } = caseRecord;
  const visaBlocked = stage.waitingOn === "visa_availability";
  const basis = basisText(caseRecord);
  const lastMovementDay = caseRecord.lastChangedAt ? easternDate(caseRecord.lastChangedAt) : null;
  const hasSnapshot = Boolean(caseRecord.latestSnapshotId);
  // The callout already asks whether the appointment happened; do not ask twice.
  const noteText = stage.note
    ?.split(/(?<=.)s+/)
    .filter((sentence) => !/Record whether/.test(sentence))
    .join(" ");

  return (
    <article className="card case-card" aria-label={`${caseRecord.formType ?? "Case"} status`}>
      <p className="case-form muted">{formLabel(caseRecord.formType)}</p>
      <h3 className={`t-display status status-${status.tone}`}>{status.title}</h3>
      <StageBar stage={stage.stage} />
      <p className="case-meaning">{status.meaning}</p>

      <NextStep caseRecord={caseRecord} facts={facts} refresh={refresh} showToast={showToast} />

      <dl className="facts">
        {expectation.filedOn && (
          <div>
            <dt>Filed</dt>
            <dd>
              {formatSmartDay(expectation.filedOn)}
              {expectation.timeSinceFiledDays !== null && <span className="muted"> · {daysAgo(expectation.timeSinceFiledDays)}</span>}
            </dd>
          </div>
        )}
        {lastMovementDay && (
          <div>
            <dt>Last movement</dt>
            <dd>
              {formatSmartDay(lastMovementDay)}
              {expectation.timeSinceLastMovementDays !== null && <span className="muted"> · {daysAgo(expectation.timeSinceLastMovementDays)}</span>}
            </dd>
          </div>
        )}
        {!visaBlocked && expectation.window && (
          <div>
            <dt>
              Expected decision
              {basis && (
                <button
                  type="button"
                  className="info-button"
                  aria-expanded={basisOpen}
                  aria-label="How this is estimated"
                  onClick={() => setBasisOpen((open) => !open)}
                >
                  <Info size={14} aria-hidden="true" />
                </button>
              )}
            </dt>
            <dd>
              {windowLabel(expectation.window.from, expectation.window.to)}
              {expectation.pastWindow && <span className="muted"> · past the usual range</span>}
            </dd>
          </div>
        )}
      </dl>
      {basisOpen && basis && <p className="basis label muted">{basis}.</p>}
      {visaBlocked && <p className="waiting-visa">Waiting on visa availability. See your place in line above.</p>}
      {noteText && <p className="label muted case-note">{noteText}</p>}

      <details className="disclosure case-details">
        <summary>Case details</summary>
        <div className="disclosure-body">
          <p className="muted">
            Receipt <span className="mono">{caseRecord.receiptNumber}</span>
            {person.name ? ` · ${person.name}` : ""}
          </p>
          <div className="button-row">
            <a className="button button-ghost" href={uscisCaseApiUrl(caseRecord.receiptNumber)} target="_blank" rel="noreferrer">
              <ArrowUpRight size={15} /> USCIS API
            </a>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => caseRecord.latestSnapshotId && onOpenSnapshot(caseRecord.latestSnapshotId)}
              disabled={!hasSnapshot || busy === caseRecord.latestSnapshotId}
            >
              {busy === caseRecord.latestSnapshotId ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
              Latest response
            </button>
            <button type="button" className="button button-ghost danger" onClick={onDelete} disabled={busy === caseRecord.id}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
        </div>
      </details>
    </article>
  );
}
