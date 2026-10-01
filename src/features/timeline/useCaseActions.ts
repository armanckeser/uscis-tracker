import { useState } from "react";
import { addCase, addPerson, deleteCase } from "../../lib/api";
import { ignoreReceipts, unignoreReceipt } from "../../lib/ignoredReceipts";
import type { PersonRecord, RefreshSummary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";

// Owns the case/person mutations the timeline triggers, plus the single "busy"
// key the UI uses to disable the in-flight control. Keeps the view declarative.
export function useCaseActions({
  people,
  refresh,
  showToast,
}: {
  people: PersonRecord[];
  refresh: RefreshSummary;
  showToast: ShowToast;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function addCaseForPerson(personId: string, receiptNumber: string) {
    const person = people.find((candidate) => candidate.id === personId);
    setBusy(`add-case-${personId}`);
    try {
      // Nothing can read the case for us: the first snapshot arrives when a human
      // refreshes from a signed-in USCIS tab, so say that instead of implying the
      // tracker is about to go and look.
      await addCase({ receiptNumber, personId });
      unignoreReceipt(receiptNumber);
      showToast("success", `${receiptNumber} added. Refresh from USCIS to record ${person?.name ?? "their"} first snapshot.`);
      await refresh(true);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not add case.");
    } finally {
      setBusy(null);
    }
  }

  async function addNewPerson(name: string) {
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
  }

  function removeCase(caseId: string, receiptNumber: string) {
    const confirmed = window.confirm(`Delete ${receiptNumber}? This removes its snapshots and timeline history.`);
    if (!confirmed) return;
    void (async () => {
      setBusy(caseId);
      try {
        await deleteCase(caseId);
        // A refresh finds every case on the account, this one included.
        ignoreReceipts([receiptNumber]);
        showToast("success", `${receiptNumber} was deleted.`);
        await refresh(true);
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Could not delete case.");
      } finally {
        setBusy(null);
      }
    })();
  }

  return { busy, setBusy, addCaseForPerson, addNewPerson, removeCase };
}
