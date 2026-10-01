/**
 * Which tracker this build is.
 *
 * Self-hosted talks to its own API and Postgres. The browser-only build has no
 * server at all: every person, case and snapshot lives in this browser's
 * IndexedDB, and the refresh bookmark hands case data over in the URL fragment,
 * which a browser never sends to the host.
 */
export const LOCAL_MODE = import.meta.env.VITE_BACKEND === "local";

/** The path the app is served under, ending in "/". "/" self-hosted, "/uscis-tracker/" on GitHub Pages. */
export const BASE_PATH = import.meta.env.BASE_URL || "/";

/** The address of the app itself, ending in "/". What a refresh bookmark comes back to. */
export function appUrl(): string {
  return new URL(BASE_PATH, window.location.origin).href;
}

/**
 * True when running as an installed Home Screen app. On iOS that copy has its own
 * storage, separate from Safari's, so a refresh run in Safari never reaches it.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}
