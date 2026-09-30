import { FormEvent, useEffect, useState } from "react";
import { CalendarPlus, Check, Loader2, MapPin } from "lucide-react";
import { googleCalendarUrl, mapsUrl } from "../../lib/appointment";
import { putNoticeDetails } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { FillableField, LifecycleEntry } from "../../../shared/lifecycle";
import type { ShowToast } from "../../hooks/useToast";

// The user-fillable detail block under a notice row. The case-service API never
// carries an appointment address, an RFE deadline, or a card tracking number,
// so the lifecycle entry declares which fields a human can enter; we render an
// input per field, persist them keyed by letterId, and turn an address into a
// map link and an appointment datetime into an "add to calendar" link.
export function NoticeDetailEditor({
  entry,
  letterId,
  appointmentIso,
  savedDetails,
  showToast,
  onSaved,
}: {
  entry: LifecycleEntry;
  letterId: string | null;
  appointmentIso: string | null;
  savedDetails: Record<string, string>;
  showToast: ShowToast;
  onSaved: () => Promise<void> | void;
}) {
  const fillable = entry.fillable ?? [];
  const [values, setValues] = useState<Record<string, string>>(savedDetails);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(savedDetails);
  }, [savedDetails]);

  const address = findByKind(fillable, values, "address");
  const mapHref = mapsUrl(address);
  const calendarHref = appointmentIso
    ? googleCalendarUrl({ title: entry.title, startIso: appointmentIso, location: address ?? undefined })
    : null;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!letterId) {
      showToast("error", "This notice has no letter id, so its details cannot be saved.");
      return;
    }
    setSaving(true);
    try {
      await putNoticeDetails(letterId, values);
      showToast("success", "Saved.");
      await onSaved();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not save details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="notice-detail">
      {appointmentIso && (
        <p className="notice-detail-when">
          <strong>{formatDateTime(appointmentIso)}</strong>
        </p>
      )}

      {fillable.length > 0 && (
        <form className="notice-detail-form" onSubmit={handleSave}>
          {fillable.map((field) => (
            <label key={field.key}>
              {field.label}
              <FieldInput
                field={field}
                value={values[field.key] ?? ""}
                onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
              />
            </label>
          ))}
          <button className="button button-secondary" type="submit" disabled={saving || !letterId}>
            {saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
            Save
          </button>
        </form>
      )}

      <div className="notice-detail-actions">
        {mapHref && (
          <a className="button button-ghost" href={mapHref} target="_blank" rel="noreferrer">
            <MapPin size={15} /> Map
          </a>
        )}
        {calendarHref && (
          <a className="button button-ghost" href={calendarHref} target="_blank" rel="noreferrer">
            <CalendarPlus size={15} /> Add to calendar
          </a>
        )}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FillableField;
  value: string;
  onChange: (next: string) => void;
}) {
  if (field.kind === "date") {
    return <input type="date" value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.kind === "address") {
    return <textarea rows={2} value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input type="text" value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function findByKind(fields: FillableField[], values: Record<string, string>, kind: FillableField["kind"]): string | null {
  const field = fields.find((candidate) => candidate.kind === kind);
  if (!field) return null;
  const value = values[field.key]?.trim();
  return value ? value : null;
}
