import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Download, Loader2, ShieldCheck, Trash2, Upload } from "lucide-react";
import { localBackend } from "../../lib/backend/local";
import type { RefreshSummary, Summary } from "../../lib/types";
import type { ShowToast } from "../../hooks/useToast";

type Busy = "backup" | "restore" | "erase" | "persist" | null;

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// The browser-only build's answer to "where does this go?". It replaces the
// notification panel: with no server there is nothing to push from, and the
// thing a person needs to know instead is that the data is here and only here.
export function LocalDataPanel({
  summary,
  refresh,
  showToast,
}: {
  summary: Summary | null;
  refresh: RefreshSummary;
  showToast: ShowToast;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  // null until the browser answers, or when it has no way to be asked.
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasData = (summary?.people.length ?? 0) > 0;
  const canAskToPersist = typeof navigator !== "undefined" && Boolean(navigator.storage?.persist);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);

  async function run(kind: Exclude<Busy, null>, work: () => Promise<void>, failure: string) {
    setBusy(kind);
    try {
      await work();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : failure);
    } finally {
      setBusy(null);
    }
  }

  const handleBackup = () =>
    run(
      "backup",
      async () => {
        const backup = await localBackend().exportData();
        download(`uscis-tracker-backup-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup));
        showToast("success", "Backup downloaded. It holds your receipt numbers and case history, so keep it somewhere private.");
      },
      "Could not make a backup.",
    );

  function handleRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (hasData && !window.confirm("Replace everything in this browser with the backup? What is here now will be removed.")) return;

    void run(
      "restore",
      async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new Error("That file is not a USCIS Tracker backup.");
        }
        const restored = await localBackend().restoreData(parsed);
        await refresh(true);
        showToast("success", `Restored ${restored.people} ${restored.people === 1 ? "person" : "people"} and ${restored.cases} ${restored.cases === 1 ? "case" : "cases"}.`);
      },
      "Could not restore that backup.",
    );
  }

  function handleErase() {
    if (!window.confirm("Erase every person, case and snapshot from this browser? This cannot be undone without a backup.")) return;
    void run(
      "erase",
      async () => {
        await localBackend().eraseData();
        await refresh(true);
        showToast("info", "Everything was erased from this browser.");
      },
      "Could not erase the data.",
    );
  }

  const handlePersist = () =>
    run(
      "persist",
      async () => {
        const granted = await navigator.storage.persist();
        setPersisted(granted);
        showToast(
          granted ? "success" : "info",
          granted ? "This browser will keep the data until you clear it yourself." : "This browser declined. A backup file is the safe copy.",
        );
      },
      "Could not ask the browser.",
    );

  return (
    <section className="section-panel">
      <div className="section-heading">
        <h2>Your data</h2>
        <p>
          Everything you enter or refresh is stored in this browser, on this device. Nothing is uploaded: there is no
          account and no server behind this page. The only thing it downloads is the public visa bulletin history.
        </p>
      </div>

      <p>
        {persisted
          ? "This browser has agreed not to clear it on its own. Clearing your browsing data still removes it, so keep a backup file."
          : "A browser can clear a site's stored data on its own, and clearing your browsing data removes it too. Keep a backup file."}{" "}
        A backup is also how you move to another browser or device.
      </p>

      <div className="button-row">
        <button className="button button-secondary" type="button" onClick={() => void handleBackup()} disabled={busy !== null || !hasData}>
          {busy === "backup" ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
          Download backup
        </button>
        <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          {busy === "restore" ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
          Restore from backup
        </button>
        {persisted === false && canAskToPersist && (
          <button className="button button-secondary" type="button" onClick={() => void handlePersist()} disabled={busy !== null}>
            {busy === "persist" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
            Ask this browser to keep it
          </button>
        )}
        <button className="button button-ghost danger" type="button" onClick={handleErase} disabled={busy !== null || !hasData}>
          {busy === "erase" ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
          Erase everything
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={handleRestore} aria-label="Backup file" />
      </div>
    </section>
  );
}
