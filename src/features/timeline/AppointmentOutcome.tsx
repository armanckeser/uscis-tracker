import { useState } from "react";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { deleteCaseFact, recordCaseFact } from "../../lib/api";
import { formatCalendarDay } from "../../lib/format";
import type { CaseFact } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";

// Asks the one question USCIS can never answer.
//
// USCIS reports that an appointment was scheduled and then says nothing more. It
// never reports attendance, so before this the app had no way to stop showing a
// biometrics slot the user had already been to. The answer is a human fact, and
// it is recorded as an event with its own date rather than a flag on the notice.
export function AppointmentOutcome({
  caseId,
  letterId,
  appointmentIso,
  fact,
  showToast,
  onSaved,
  compact = false,
}: {
  caseId: string;
  letterId: string | null;
  appointmentIso: string;
  fact: CaseFact | null;
  showToast: ShowToast;
  onSaved: () => Promise<void> | void;
  /** Inside the next-step callout, which already says what and when. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function answer(kind: CaseFact["kind"]) {
    setBusy(true);
    try {
      await recordCaseFact(caseId, {
        kind,
        // The appointment's own date is the answer's date: the user is telling us
        // what happened at that appointment, not on some other day.
        occurredOn: appointmentIso.slice(0, 10),
        letterId: letterId ?? undefined,
      });
      await onSaved();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function undo(factId: string) {
    setBusy(true);
    try {
      await deleteCaseFact(factId);
      await onSaved();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not undo that.");
    } finally {
      setBusy(false);
    }
  }

  if (fact && compact) {
    return (
      <button className="text-button" type="button" onClick={() => void undo(fact.id)} disabled={busy}>
        {busy ? <Loader2 className="spin" size={15} /> : <Undo2 size={15} />}
        Undo
      </button>
    );
  }

  if (fact) {
    return (
      <div className="appointment-outcome is-answered">
        <p>
          {fact.kind === "appointment_attended" ? "You went" : "Missed"} · {formatCalendarDay(fact.occurredOn)}
        </p>
        <button className="button button-ghost" type="button" onClick={() => void undo(fact.id)} disabled={busy}>
          {busy ? <Loader2 className="spin" size={15} /> : <Undo2 size={15} />}
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className="appointment-outcome">
      {compact ? <p className="muted">Did you go?</p> : <p>This date has passed. Did you go?</p>}
      <div className="appointment-outcome-actions">
        <button className="button button-soft" type="button" onClick={() => void answer("appointment_attended")} disabled={busy}>
          {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
          I went
        </button>
        <button className="button button-ghost" type="button" onClick={() => void answer("appointment_missed")} disabled={busy}>
          <X size={15} />
          I missed it
        </button>
      </div>
    </div>
  );
}
