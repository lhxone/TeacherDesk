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

type Logger = { warn: (o: unknown, m?: string) => void };

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
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  logger?: Logger,
): Promise<number> {
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
          // Without a TTL some push services (FCM) drop the message immediately
          // when the device is offline instead of holding it.
          { TTL: 3600 },
        );
        delivered += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Dead subscription: browser uninstalled or permission revoked.
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          // 400 (VAPID mismatch — e.g. keys rotated), 413 (payload too big), 429,
          // 5xx. Silently swallowing these is why "push stopped working" is so
          // hard to diagnose in production.
          logger?.warn(
            { statusCode: status, endpoint: sub.endpoint.slice(0, 60), userId },
            'web push delivery failed',
          );
        }
      }
    }),
  );

  return delivered;
}
