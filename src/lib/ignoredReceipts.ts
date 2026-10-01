// Receipts the user deleted or declined. The refresh script finds every case on
// the signed-in account, so without this a deleted case would come straight back
// on the next run.
//
// Kept in this browser rather than on the server: it is a note about what one
// person does not want re-offered, and the worst a missing note costs is one
// more "whose is this?" to dismiss.

const KEY = "uscis-tracker:ignored-receipts";

export function ignoredReceipts(): Set<string> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function save(receipts: Set<string>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...receipts]));
  } catch {
    // Storage is full or blocked. The case is offered again next time; nothing is lost.
  }
}

export function ignoreReceipts(receiptNumbers: readonly string[]) {
  const receipts = ignoredReceipts();
  for (const receiptNumber of receiptNumbers) receipts.add(receiptNumber);
  save(receipts);
}

/** Adding a case by hand is a change of mind, so it stops being ignored. */
export function unignoreReceipt(receiptNumber: string) {
  const receipts = ignoredReceipts();
  if (receipts.delete(receiptNumber)) save(receipts);
}
