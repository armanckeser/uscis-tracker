import { FormEvent, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { RECEIPT_PATTERN } from "../../lib/uscis";
import type { ShowToast } from "../../hooks/useToast";

// Inline receipt-add for one person: a "+" that opens a single-field form. The
// person is fixed (it lives under their header), so unlike the old full page
// there is no person picker to get wrong.
export function AddCaseInline({
  personName,
  busy,
  showToast,
  onAdd,
}: {
  personName: string;
  busy: boolean;
  showToast: ShowToast;
  onAdd: (receiptNumber: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = receipt.trim().toUpperCase();
    if (!RECEIPT_PATTERN.test(normalized)) {
      showToast("error", "Receipt number needs 3 letters then 10 digits, e.g. IOE1234567890.");
      return;
    }
    await onAdd(normalized);
    setReceipt("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="button button-ghost" type="button" onClick={() => setOpen(true)} aria-label={`Add a case for ${personName}`}>
        <Plus size={15} /> Case
      </button>
    );
  }

  return (
    <form className="add-inline-form" onSubmit={handleSubmit}>
      <input
        name="receiptNumber"
        value={receipt}
        autoFocus
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="IOE1234567890"
        pattern="[A-Za-z]{3}[0-9]{10}"
        onChange={(event) => setReceipt(event.target.value)}
      />
      <button className="button button-primary" type="submit" disabled={busy}>
        {busy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}
        Add
      </button>
      <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Cancel">
        <X size={15} />
      </button>
    </form>
  );
}
