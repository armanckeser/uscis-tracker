import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "success" | "error" | "info";
export type Toast = { tone: ToastTone; message: string } | null;

const TOAST_VISIBLE_MS = 4200;

export type ShowToast = (tone: ToastTone, message: string) => void;

/**
 * A single transient toast with auto-dismiss.
 *
 * `toast` keeps the last message after it closes so the exit transition has
 * something to fade; `open` says whether it is showing. Each new toast clears
 * the previous timer, so an old timeout can never dismiss a newer message.
 */
export function useToast() {
  const [toast, setToast] = useState<Toast>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const showToast = useCallback<ShowToast>((tone, message) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setToast({ tone, message });
    setOpen(true);
    timer.current = window.setTimeout(() => {
      setOpen(false);
      timer.current = null;
    }, TOAST_VISIBLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { toast, open, showToast };
}
