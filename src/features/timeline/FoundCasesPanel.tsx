import { useState } from "react";
import { Loader2 } from "lucide-react";
import { formCode } from "../../lib/uscisCopy";
import type { FoundCase } from "../../lib/refreshHandoff";
import type { PersonRecord } from "../../lib/types";

// Cases a refresh found on a USCIS account that the tracker does not track yet,
// when there is more than one person they could belong to. The script cannot
// tell whose account it ran in, and a guess could file one person's case under
// the other, so this asks once.
export function FoundCasesPanel({
  found,
  people,
  onAssign,
  onDismiss,
}: {
  found: FoundCase[];
  people: PersonRecord[];
  onAssign: (person: { id: string; name: string }) => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (found.length === 0) return null;

  async function handleAssign(person: PersonRecord) {
    setBusy(person.id);
    try {
      await onAssign({ id: person.id, name: person.name });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="found-cases" aria-label="New cases found on USCIS">
      <div>
        <h2>
          {found.length} new {found.length === 1 ? "case" : "cases"} found on USCIS
        </h2>
        <ul className="found-cases-list">
          {found.map((item) => (
            <li key={item.receiptNumber}>
              <strong>{formCode(item.formType)}</strong> <span className="mono muted">{item.receiptNumber}</span>
            </li>
          ))}
        </ul>
      </div>

      {people.length === 0 ? (
        <p className="muted">Add a person below, then choose them here.</p>
      ) : (
        <div className="found-cases-actions">
          <span className="muted">{found.length === 1 ? "Whose is it?" : "Whose are they?"}</span>
          {people.map((person) => (
            <button key={person.id} className="button button-primary" type="button" disabled={busy !== null} onClick={() => void handleAssign(person)}>
              {busy === person.id && <Loader2 className="spin" size={15} />}
              {person.name}
            </button>
          ))}
        </div>
      )}

      <button className="text-button" type="button" disabled={busy !== null} onClick={onDismiss}>
        Don't track {found.length === 1 ? "it" : "these"}
      </button>
    </section>
  );
}
