/// <reference lib="webworker" />
/**
 * TeacherDesk service worker (injectManifest).
 *
 * Two jobs:
 *  1. Precache the built assets + the runtime caching that used to live in
 *     vite.config.ts's `workbox.runtimeCaching` block. The privacy rules there
 *     are unchanged — see the comments on each route.
 *  2. Web Push: show a notification on `push`, focus/open the app on
 *     `notificationclick`. This is what makes reminders arrive when the tab or
 *     PWA is closed.
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// --- runtime caching (privacy rules preserved from the old config) ---

// Auth endpoints must never be cached — a cached /auth/me would hand the next
// visitor the previous teacher's identity.
registerRoute(/\/api\/v1\/auth\//, new NetworkOnly());

// Offline reads for PRD §3.8 / AC-16. These responses contain student names,
// phone numbers and scores, so: NetworkFirst (never StaleWhileRevalidate) with a
// short TTL, and the `td-` cache-name prefix so purgeApiCaches() can wipe it on
// login/logout/auth-failure.
registerRoute(
  /\/api\/v1\/(classes|students|tags|schedule|events|seating-charts)/,
  new NetworkFirst({
    cacheName: 'td-data',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 12 }),
    ],
  }),
);

// Analytics is derived data, cheap to refetch and of little use offline.
registerRoute(/\/api\/v1\/analytics\//, new NetworkOnly());

// --- Web Push ---

type PushPayload = { title: string; body: string; tag?: string; url?: string };

self.addEventListener('push', (event: PushEvent) => {
  let data: PushPayload = { title: '教师工作台', body: '你有一条新的提醒' };
  try {
    if (event.data) data = { ...data, ...(event.data.json() as PushPayload) };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      // `renotify` isn't in the lib DOM types yet but is honoured by browsers:
      // re-alert even when a notification with the same tag is already shown.
      ...(data.tag ? { renotify: true } : {}),
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url: data.url ?? '/' },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data?.url as string) ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void client.focus();
          if ('navigate' in client) void client.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
