import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { RawSnapshotModal } from "../src/components/RawSnapshotModal.js";
import type { SnapshotResponse } from "../src/lib/types.js";

// A rail row's Evidence opens the snapshot that first recorded that row, which is
// correct as audit and routinely much older than the newest response on file.
// Reading a June snapshot and asking "so where is the newest pull?" was answered
// only by a button hidden inside a collapsed case header.

const juneSnapshot: SnapshotResponse["snapshot"] = {
  id: "snapshot-june",
  case_id: "case-1",
  receipt_number: "IOE1234567801",
  form_type: "I-485",
  checked_at: "2026-06-22T23:53:45.711Z",
  source: "manual",
  raw_hash: "hash-june",
  raw_data: { receiptNumber: "IOE1234567801", updatedAtTimestamp: "2026-06-22T13:37:50.039Z" },
};

function render(latestSnapshotId: string | null) {
  return renderToString(
    <RawSnapshotModal
      snapshot={juneSnapshot}
      latestSnapshotId={latestSnapshotId}
      onOpenLatest={() => {}}
      onClose={() => {}}
    />,
  );
}

describe("RawSnapshotModal", () => {
  it("offers_the_newest_response_when_the_open_snapshot_is_not_the_newest", () => {
    expect(render("snapshot-july")).toContain("Newest response");
  });

  it("omits_the_offer_when_the_open_snapshot_is_already_the_newest", () => {
    // Otherwise the button reopens what is on screen and reads as a broken control.
    expect(render("snapshot-june")).not.toContain("Newest response");
  });

  it("omits_the_offer_when_the_case_is_not_on_the_summary", () => {
    expect(render(null)).not.toContain("Newest response");
  });

  it("names_both_clocks_so_an_old_snapshot_is_not_read_as_current_state", () => {
    const html = render("snapshot-july");
    expect(html).toContain("IOE1234567801");
    expect(html).toContain("USCIS last touched the case");
  });
});
