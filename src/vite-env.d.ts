/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "local" builds the browser-only tracker: no server, data in IndexedDB. */
  readonly VITE_BACKEND?: string;
  /** Where the visa bulletin dataset is fetched from in the browser-only build. */
  readonly VITE_BULLETIN_BASE_URL?: string;
}
