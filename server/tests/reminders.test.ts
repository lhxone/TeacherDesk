import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, resetDb, registerUser, createClass, prisma, type TestUser } from './helpers.js';
import { runReminderScan } from '../src/lib/reminder.js';

// The scan calls sendPushToUser, which is a no-op without VAPID keys. Stub it so
// we can assert *what* the scheduler decided to send without configuring push.
const sent: { userId: string; payload: unknown }[] = [];
vi.mock('../src/lib/push.js', () => ({
  sendPushToUser: vi.fn(async (userId: string, payload: unknown) => {
    sent.push({ userId, payload });
    return 1;
  }),
}));

let app: FastifyInstance;
let user: TestUser;

async function enableReminders(minutes: number) {
  await app.inject({
    method: 'PATCH',
    url: '/api/v1/auth/me',
    headers: user.auth,
    payload: { settings: { pushRemindersEnabled: true, remindBeforeMinutes: minutes } },
  });
}

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  app = await createTestApp();
  user = await registerUser(app);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('reminder scan: todos', () => {
  it('pushes for a timed todo starting inside the lead window', async () => {
    await enableReminders(5);
    const now = new Date('2026-09-14T09:00:00.000Z');
    const startAt = new Date('2026-09-14T09:04:00.000Z'); // 4 min out

    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: { title: '收作业', startAt: startAt.toISOString() },
    });

    const pushed = await runReminderScan(now);
    expect(pushed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: '待办：收作业' });
  });

  it('does not push twice for the same occurrence', async () => {
    await enableReminders(5);
    const now = new Date('2026-09-14T09:00:00.000Z');
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: { title: '收作业', startAt: '2026-09-14T09:04:00.000Z' },
    });

    await runReminderScan(now);
    await runReminderScan(new Date('2026-09-14T09:01:00.000Z'));
    expect(sent).toHaveLength(1);

    const ledger = await prisma.sentReminder.count({ where: { userId: user.id, kind: 'event' } });
    expect(ledger).toBe(1);
  });

  it('ignores todos outside the window, done todos, and all-day todos', async () => {
    await enableReminders(5);
    const now = new Date('2026-09-14T09:00:00.000Z');

    await app.inject({ method: 'POST', url: '/api/v1/events', headers: user.auth,
      payload: { title: '太远', startAt: '2026-09-14T10:00:00.000Z' } });
    await app.inject({ method: 'POST', url: '/api/v1/events', headers: user.auth,
      payload: { title: '全天', startAt: '2026-09-14T09:03:00.000Z', allDay: true } });
    const done = await app.inject({ method: 'POST', url: '/api/v1/events', headers: user.auth,
      payload: { title: '已完成', startAt: '2026-09-14T09:03:00.000Z' } });
    await app.inject({ method: 'PATCH', url: `/api/v1/events/${done.json().data.id}`,
      headers: user.auth, payload: { isDone: true } });

    const pushed = await runReminderScan(now);
    expect(pushed).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('sends nothing when the user has reminders disabled', async () => {
    const now = new Date('2026-09-14T09:00:00.000Z');
    await app.inject({ method: 'POST', url: '/api/v1/events', headers: user.auth,
      payload: { title: '收作业', startAt: '2026-09-14T09:04:00.000Z' } });

    const pushed = await runReminderScan(now);
    expect(pushed).toBe(0);
  });

  it('honours a custom lead time', async () => {
    await enableReminders(30);
    const now = new Date('2026-09-14T09:00:00.000Z');
    await app.inject({ method: 'POST', url: '/api/v1/events', headers: user.auth,
      payload: { title: '收作业', startAt: '2026-09-14T09:20:00.000Z' } });

    expect(await runReminderScan(now)).toBe(1);
  });
});

describe('reminder scan: lessons', () => {
  it('pushes 5 minutes before a lesson period (default periodTimes, UTC+8)', async () => {
    await enableReminders(5);
    const classId = await createClass(app, user);
    // First period is 08:00–08:45 local (UTC+8) => 00:00 UTC.
    await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: { classId, subject: '数学', weekday: 1, period: 1, repeatRule: 'weekly' },
    });

    // 2026-09-14 is a Monday. 07:56 local == 23:56 UTC on the 13th.
    const now = new Date('2026-09-13T23:56:00.000Z');
    const pushed = await runReminderScan(now);

    expect(pushed).toBe(1);
    expect(sent[0].payload).toMatchObject({ title: '数学 即将开始' });
  });

  it('uses the user\'s custom daySchedule for the lesson start time', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: user.auth,
      payload: {
        settings: {
          pushRemindersEnabled: true,
          remindBeforeMinutes: 5,
          daySchedule: [
            { key: 'p1', kind: 'lesson', label: '第1节', start: '07:40', end: '08:20' },
          ],
        },
      },
    });
    const classId = await createClass(app, user);
    await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: { classId, subject: '语文', weekday: 1, period: 1, repeatRule: 'weekly' },
    });

    // 07:40 local (UTC+8) == 23:40 UTC on the 13th. 07:36 local == 23:36 UTC.
    expect(await runReminderScan(new Date('2026-09-13T23:36:00.000Z'))).toBe(1);
    expect(sent[0].payload).toMatchObject({ title: '语文 即将开始' });
  });

  it('uses the user\'s own timeZone instead of the server-wide fallback', async () => {
    // This app is public and teachers can be in any timezone — a teacher in
    // America/New_York with an 08:00 first period must be reminded relative
    // to New York time, not the UTC+8 fallback used elsewhere in this file.
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: user.auth,
      payload: { settings: { pushRemindersEnabled: true, remindBeforeMinutes: 5, timeZone: 'America/New_York' } },
    });
    const classId = await createClass(app, user);
    await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: { classId, subject: '数学', weekday: 1, period: 1, repeatRule: 'weekly' },
    });

    // 2026-09-14 is a Monday. First period 08:00 America/New_York (EDT, UTC-4)
    // == 12:00 UTC. 5 minutes before is 11:56 UTC.
    const tooEarlyForUtc8 = await runReminderScan(new Date('2026-09-14T11:56:00.000Z'));
    expect(tooEarlyForUtc8).toBe(1);
    expect(sent[0].payload).toMatchObject({ title: '数学 即将开始' });

    // The old UTC+8-only fallback would have fired 16 hours earlier (23:56 the
    // 13th); confirm nothing fires there for this user.
    sent.length = 0;
    await prisma.sentReminder.deleteMany({ where: { userId: user.id } });
    const atUtc8Instant = await runReminderScan(new Date('2026-09-13T23:56:00.000Z'));
    expect(atUtc8Instant).toBe(0);
  });

  it('does not push for a lesson on a different weekday', async () => {
    await enableReminders(5);
    const classId = await createClass(app, user);
    await app.inject({ method: 'POST', url: '/api/v1/schedule/slots', headers: user.auth,
      payload: { classId, subject: '数学', weekday: 3, period: 1, repeatRule: 'weekly' } });

    const now = new Date('2026-09-13T23:56:00.000Z'); // Monday morning
    expect(await runReminderScan(now)).toBe(0);
  });
});

describe('push subscription routes', () => {
  it('reports push disabled when no VAPID key is configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/push/vapid-public-key',
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ key: null, enabled: false });
  });

  it('upserts a subscription and forgets it on delete', async () => {
    const sub = {
      endpoint: 'https://push.example.com/abc',
      keys: { p256dh: 'x'.repeat(20), auth: 'y'.repeat(20) },
    };

    const create = await app.inject({ method: 'POST', url: '/api/v1/push/subscriptions',
      headers: user.auth, payload: sub });
    expect(create.statusCode).toBe(201);
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);

    // Same endpoint again → still one row.
    await app.inject({ method: 'POST', url: '/api/v1/push/subscriptions', headers: user.auth, payload: sub });
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);

    const del = await app.inject({ method: 'DELETE', url: '/api/v1/push/subscriptions',
      headers: user.auth, payload: { endpoint: sub.endpoint } });
    expect(del.statusCode).toBe(204);
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects an unauthenticated subscription', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/push/subscriptions',
      payload: { endpoint: 'https://push.example.com/x', keys: { p256dh: 'a', auth: 'b' } } });
    expect(res.statusCode).toBe(401);
  });
});
