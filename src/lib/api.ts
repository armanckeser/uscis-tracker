// The one seam between the UI and wherever the data lives. Self-hosted, that is
// the tracker's API; in the browser-only build it is this browser's IndexedDB.

import { LOCAL_MODE } from "./mode";
import * as http from "./backend/http";
import { localBackend } from "./backend/local";
import type { Backend } from "./backend/types";

export type { ImportResult } from "./backend/types";

const backend: Backend = LOCAL_MODE ? localBackend() : http;

export const {
  getSummary,
  addPerson,
  addCase,
  deleteCase,
  importSnapshot,
  recordCaseFact,
  deleteCaseFact,
  acknowledgeChanges,
  getSnapshot,
  putNoticeDetails,
  subscribePush,
  unsubscribePush,
  patchPerson,
  getBulletinHistory,
} = backend;
