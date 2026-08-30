/**
 * Web Push delivery. Wraps the `web-push` library so the rest of the app only
 * deals with "send this payload to this user's devices".
 *
 * VAPID keys come from the environment (config.vapidPublicKey / PrivateKey).
 * When they are unset `pushEnabled()` is false and every send is a no-op, so the
 * API and the reminder loop keep working without push configured.
 */
import webpush from 'web-push';
import { prisma } from '../db.js';
import { config, pushEnabled } from '../config.js';

let configured = false;

function ensureConfigured() {
  if (configured || !pushEnabled()) return;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Notifications sharing a tag replace each other instead of stacking. */
  tag?: string;
  /** Path to open when the notification is clicked. */
  url?: string;
};

/**
 * Push `payload` to every registered device of `userId`. A 404/410 from the push
 * service means the subscription is dead (browser uninstalled, permission
 * revoked) — those rows are deleted so they are not retried forever.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  ensureConfigured();
  if (!pushEnabled()) return 0;

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        delivered += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }),
  );

  return delivered;
}
