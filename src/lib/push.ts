import { subscribePush, unsubscribePush } from "./api";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export function canUsePush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function enablePush(vapidPublicKey: string) {
  if (!canUsePush()) throw new Error("This browser does not support web push notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const registration = await registerServiceWorker();
  if (!registration) throw new Error("Service worker registration failed.");

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await subscribePush(existing);
    return existing;
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  await subscribePush(subscription);
  return subscription;
}

export async function disablePush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await unsubscribePush(endpoint);
}

export async function getPushState() {
  if (!canUsePush()) return "unsupported" as const;
  if (Notification.permission === "denied") return "denied" as const;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) return "enabled" as const;
  return Notification.permission === "granted" ? "ready" as const : "default" as const;
}
