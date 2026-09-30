import { useEffect, useState } from "react";
import { disablePush, enablePush, getPushState } from "../lib/push";
import type { ShowToast } from "./useToast";

export type PushState = Awaited<ReturnType<typeof getPushState>>;

/** Tracks this device's push-notification state and toggles it. */
export function usePush(vapidPublicKey: string | null | undefined, showToast: ShowToast) {
  const [pushState, setPushState] = useState<PushState>("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushState().then(setPushState);
  }, []);

  async function toggle() {
    if (!vapidPublicKey) {
      showToast("error", "Web Push is not configured. Add VAPID keys to the server environment.");
      return;
    }
    setBusy(true);
    try {
      if (pushState === "enabled") {
        await disablePush();
        showToast("info", "Notifications are disabled on this device.");
      } else {
        await enablePush(vapidPublicKey);
        showToast("success", "Notifications are enabled on this device.");
      }
      setPushState(await getPushState());
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not update notification settings.");
    } finally {
      setBusy(false);
    }
  }

  return { pushState, pushBusy: busy, togglePush: toggle };
}
