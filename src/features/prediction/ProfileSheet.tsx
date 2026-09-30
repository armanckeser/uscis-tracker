import { useState, type FormEvent } from "react";
import { Loader2, X } from "lucide-react";
import { Overlay } from "../../components/Overlay";
import { patchPerson } from "../../lib/api";
import type { PersonRecord, RefreshSummary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";
import { CATEGORY_OPTIONS, COUNTRY_OPTIONS, categoryName, countryName } from "../../lib/uscisCopy";

const EMPLOYMENT = CATEGORY_OPTIONS.filter((option) => option.group === "Employment");
const FAMILY = CATEGORY_OPTIONS.filter((option) => option.group === "Family");

/**
 * Category, country and priority date for one person. The USCIS payload carries
 * none of these, so this sheet is the only way the predictions get their input.
 * A derivative points at a principal and inherits whatever they leave blank.
 */
export function ProfileSheet({
  person,
  people,
  refresh,
  showToast,
  onClose,
}: {
  person: PersonRecord;
  people: PersonRecord[];
  refresh: RefreshSummary;
  showToast: ShowToast;
  onClose: () => void;
}) {
  const { profile } = person;
  const [principalId, setPrincipalId] = useState(profile.principalPersonId ?? "");
  const [category, setCategory] = useState(profile.category ?? "");
  const [chargeability, setChargeability] = useState(profile.chargeability ?? "");
  const [priorityDate, setPriorityDate] = useState(profile.priorityDate ?? "");
  const [busy, setBusy] = useState(false);

  const others = people.filter((candidate) => candidate.id !== person.id);
  const principal = others.find((candidate) => candidate.id === principalId) ?? null;
  const inherits = Boolean(principal);
  const immediate = /^(IR|CR)/.test(category || (principal?.profile.effective.category ?? ""));
  const blank = principal ? `Same as ${principal.name}` : "Choose";

  const inheritedCategory = principal?.profile.effective.category;
  const inheritedCountry = principal?.profile.effective.chargeability;
  const inheritedDate = principal?.profile.effective.priorityDate;

  async function handleSubmit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    if (!inherits && !category) return showToast("error", "Choose a category.");
    if (!inherits && !immediate && (!chargeability || !priorityDate)) return showToast("error", "Choose a country and enter the priority date.");
    setBusy(true);
    try {
      await patchPerson(person.id, {
        category: category || null,
        chargeability: immediate ? null : chargeability || null,
        priority_date: immediate ? null : priorityDate || null,
        principal_person_id: principalId || null,
      });
      await refresh(true);
      showToast("success", `${person.name}'s place in line is updated.`);
      close();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay variant="sheet" labelledBy="profile-title" onClose={onClose}>
      {(close) => (
        <form className="sheet-body" onSubmit={(event) => void handleSubmit(event, close)}>
          <div className="sheet-head">
            <div>
              <h2 id="profile-title">{person.name}&apos;s priority date</h2>
              <p className="muted">USCIS does not send these. Copy them from the I-797 receipt notice or the approved I-140.</p>
            </div>
            <button type="button" className="icon-button" onClick={close} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          {others.length > 0 && (
            <label className="field">
              <span>Uses the principal&apos;s priority date</span>
              <select value={principalId} onChange={(event) => setPrincipalId(event.target.value)}>
                <option value="">No, this is their own</option>
                {others.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} data-autofocus>
              <option value="">{inheritedCategory ? `${blank} (${categoryName(inheritedCategory)})` : blank}</option>
              <optgroup label="Employment">
                {EMPLOYMENT.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Family">
                {FAMILY.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          {!immediate && (
            <>
              <label className="field">
                <span>Country of chargeability</span>
                <select value={chargeability} onChange={(event) => setChargeability(event.target.value)}>
                  <option value="">{inheritedCountry ? `${blank} (${countryName(inheritedCountry)})` : blank}</option>
                  {COUNTRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Priority date</span>
                <input type="date" value={priorityDate} onChange={(event) => setPriorityDate(event.target.value)} required={!inherits} />
                {inheritedDate && !priorityDate && <small className="muted">Using {principal?.name}&apos;s: {inheritedDate}</small>}
              </label>
            </>
          )}

          <button className="button button-primary button-block" type="submit" disabled={busy}>
            {busy && <Loader2 className="spin" size={16} />}
            Save
          </button>
        </form>
      )}
    </Overlay>
  );
}
