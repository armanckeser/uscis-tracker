import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const EXIT_MS = 180;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Phase = "enter" | "open" | "exit";

/**
 * Shared shell for the modal and the bottom sheet (a centered dialog on desktop).
 *
 * Owns what every overlay needs and the old modal lacked: Esc closes, focus is
 * trapped and restored, the page behind does not scroll, and it enters and
 * exits with a transition. `children` receives `close`, which plays the exit
 * before calling `onClose`.
 */
export function Overlay({
  variant,
  labelledBy,
  onClose,
  children,
  className = "",
}: {
  variant: "sheet" | "modal";
  labelledBy: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("enter");
  const panelRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (exitTimer.current !== null) return;
    setPhase("exit");
    exitTimer.current = window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  // Enter on the frame after mount so the transition has a start state.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPhase((current) => (current === "enter" ? "open" : current)));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    },
    [],
  );

  // Scroll lock, and focus in / focus back.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === panelRef.current)) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  }

  return (
    <div className={`overlay overlay-${variant}`} data-phase={phase} role="presentation" onMouseDown={close} onKeyDown={handleKeyDown}>
      <div
        ref={panelRef}
        className={`overlay-panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {variant === "sheet" && <span className="sheet-grabber" aria-hidden="true" />}
        {children(close)}
      </div>
    </div>
  );
}
