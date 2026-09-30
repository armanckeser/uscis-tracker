import { Bell, BellOff, Loader2 } from "lucide-react";
import type { Summary } from "../../lib/types";
import type { PushState } from "../../hooks/usePush";

export function NotificationPanel({
  summary,
  pushState,
  pushBusy,
  onToggle,
}: {
  summary: Summary | null;
  pushState: PushState;
  pushBusy: boolean;
  onToggle: () => void;
}) {
  const disabled = pushBusy || !summary?.config.vapidPublicKey || pushState === "unsupported" || pushState === "denied";
  return (
    <section className="section-panel">
      <div className="section-heading section-heading-row">
        <div>
          <h2>Notifications</h2>
          <p>Use this device for USCIS milestones and steps, and when a new visa bulletin moves your date.</p>
        </div>
        <span className={`pill ${pushState === "enabled" ? "pill-success" : ""}`}>{pushState}</span>
      </div>
      <button className="button button-secondary" type="button" onClick={onToggle} disabled={disabled}>
        {pushBusy ? <Loader2 className="spin" size={16} /> : pushState === "enabled" ? <BellOff size={16} /> : <Bell size={16} />}
        {pushState === "enabled" ? "Disable notifications" : "Enable notifications"}
      </button>
      {!summary?.config.vapidPublicKey && <p className="hint">Web Push needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server.</p>}
    </section>
  );
}
