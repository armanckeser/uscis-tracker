// The self-hosted backend: every call goes to the tracker's own API.

import type { BulletinHistory, NoticeDetail, PatchPersonBody, SnapshotResponse, Summary } from "../types";
import type { ImportResult } from "./types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    // The request never reached the server: the tracker is only reachable over Tailscale or the home network.
    throw new Error("Can't reach the tracker. Check that Tailscale is on, then try again.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with HTTP ${response.status}.`);
  }
  return data as T;
}

export function getSummary() {
  return request<Summary>("/api/summary");
}

export function addPerson(input: { name: string }) {
  return request("/api/people", { method: "POST", body: JSON.stringify(input) });
}

export function addCase(input: { receiptNumber: string; personId: string }) {
  return request("/api/cases", { method: "POST", body: JSON.stringify(input) });
}

export function deleteCase(id: string) {
  return request("/api/cases/" + id, { method: "DELETE" });
}

export function importSnapshot(input: { raw: unknown; personId?: string }) {
  return request<ImportResult>("/api/snapshots/import", { method: "POST", body: JSON.stringify(input) });
}

export function recordCaseFact(
  caseId: string,
  input: { kind: "appointment_attended" | "appointment_missed"; occurredOn: string; letterId?: string; note?: string },
) {
  return request("/api/cases/" + caseId + "/facts", { method: "POST", body: JSON.stringify(input) });
}

export function deleteCaseFact(id: string) {
  return request("/api/facts/" + id, { method: "DELETE" });
}

export function acknowledgeChanges() {
  return request<{ acknowledged: number }>("/api/changes/acknowledge", { method: "POST" });
}

export function getSnapshot(id: string) {
  return request<SnapshotResponse>("/api/snapshots/" + id);
}

export function putNoticeDetails(letterId: string, details: Record<string, string>) {
  return request<{ noticeDetail: NoticeDetail }>("/api/notice-details/" + encodeURIComponent(letterId), {
    method: "PUT",
    body: JSON.stringify({ details }),
  });
}

export function subscribePush(subscription: PushSubscription) {
  return request("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
}

export function unsubscribePush(endpoint: string) {
  return request("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) });
}

export function patchPerson(id: string, body: PatchPersonBody) {
  return request("/api/people/" + id, { method: "PATCH", body: JSON.stringify(body) });
}

export function getBulletinHistory(category: string, country: string) {
  const query = new URLSearchParams({ category, country });
  return request<BulletinHistory>("/api/bulletins/history?" + query.toString());
}
