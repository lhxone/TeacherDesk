/**
 * Web Push subscription management (browser side).
 *
 * Flow: after login the app calls `syncPushSubscription()`. If the user has
 * previously granted notification permission we (re)subscribe with the server's
 * VAPID key and POST the subscription so the backend can reach this device.
 * `enablePush()` is what the settings toggle calls — it prompts for permission.
 */
import { api } from './client';
import type { Envelope } from './types';

type VapidInfo = { key: string | null; enabled: boolean };

function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): NotificationPermission {
  return pushSupported() ? Notification.permission : 'denied';
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
}

async function fetchVapid(): Promise<VapidInfo> {
  try {
    const res = await api.get<Envelope<VapidInfo>>('/push/vapid-public-key');
    return res.data;
  } catch {
    return { key: null, enabled: false };
  }
}

/** Subscribe this browser and register it with the server. Assumes permission is granted. */
async function subscribeAndRegister(): Promise<boolean> {
  const reg = await getRegistration();
  if (!reg) return false;

  const { key, enabled } = await fetchVapid();
  if (!enabled || !key) return false;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(key),
    }));

  const json = sub.toJSON();
  await api.post('/push/subscriptions', {
    endpoint: json.endpoint,
    keys: json.keys,
  });
  return true;
}

/** Called on app boot / after login: keep the server subscription fresh, silently. */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    await subscribeAndRegister();
  } catch {
    // Best-effort; a failed sync just means no reminders until next boot.
  }
}

/** Settings toggle → ON. Prompts for permission, then subscribes. Returns success. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const perm =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
  if (perm !== 'granted') return false;
  return subscribeAndRegister();
}

/** Settings toggle → OFF. Unsubscribes locally and tells the server to forget this device. */
export async function disablePush(): Promise<void> {
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.toJSON().endpoint ?? '';
    await sub.unsubscribe().catch(() => {});
    await api.del('/push/subscriptions', { endpoint }).catch(() => {});
  }
}

export async function sendTestPush(): Promise<number> {
  const res = await api.post<Envelope<{ delivered: number }>>('/push/test', {});
  return res.data.delivered;
}
