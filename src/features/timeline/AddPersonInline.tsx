import { FormEvent, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { ShowToast } from "../../hooks/useToast";

// The "+" at the very bottom of the rail, after every person. Adds a new
// account holder, after which their (empty) group appears to add cases to.
export function AddPersonInline({
  busy,
  showToast,
  onAdd,
  defaultOpen = false,
}: {
  busy: boolean;
  showToast: ShowToast;
  onAdd: (name: string) => Promise<void>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("error", "Enter a name.");
      return;
    }
    await onAdd(trimmed);
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="button button-ghost add-person-trigger" type="button" onClick={() => setOpen(true)}>
        <Plus size={15} /> Add a person
      </button>
    );
  }

  return (
    <form className="add-inline-form add-person-form" onSubmit={handleSubmit}>
      <input name="name" value={name} autoFocus autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" placeholder="Name" onChange={(event) => setName(event.target.value)} />
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
