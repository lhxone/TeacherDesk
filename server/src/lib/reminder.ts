/**
 * Push reminder scheduler.
 *
 * Every `config.reminderScanIntervalMs` this scans, for each user who has push
 * reminders enabled, the lessons and todos whose start falls inside the next
 * `[now, now + remindBeforeMinutes]` window and pushes one notification each.
 *
 * Recurring lessons have no per-occurrence row, so `SentReminder` is the
 * idempotency ledger: an occurrence already recorded there is skipped. That also
 * makes the loop safe against overlapping scans and process restarts.
 */
import { prisma } from '../db.js';
import { config } from '../config.js';
import { DEFAULT_SETTINGS } from '../config.js';
import { sendPushToUser } from './push.js';
import { formatDate, slotOccursOn } from './schedule.js';
import { lessonPeriodTimes } from './daySchedule.js';

type Settings = typeof DEFAULT_SETTINGS;

/** Instant of `HH:MM` wall-clock on `day` (a UTC midnight Date), in the configured local zone. */
function wallTimeToInstant(day: Date, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return new Date(day.getTime() + (minutes - config.localTzOffsetMinutes) * 60_000);
}

type PushLogger = { warn: (o: unknown, m?: string) => void };
let scanLogger: PushLogger | undefined;

/** One scan pass. Exported for tests. */
export async function runReminderScan(now: Date = new Date()): Promise<number> {
  const users = await prisma.user.findMany({ where: { deletedAt: null } });
  let pushed = 0;

  for (const user of users) {
    const settings = { ...DEFAULT_SETTINGS, ...(user.settings as object) } as Settings;
    if (!settings.pushRemindersEnabled) continue;

    const lead = Math.max(1, settings.remindBeforeMinutes || DEFAULT_SETTINGS.remindBeforeMinutes);
    const windowEnd = new Date(now.getTime() + lead * 60_000);

    pushed += await remindLessons(user.id, settings, now, windowEnd);
    pushed += await remindTodos(user.id, now, windowEnd, lead);
  }

  return pushed;
}

async function alreadySent(userId: string, kind: string, refId: string, occursAt: Date) {
  const hit = await prisma.sentReminder.findUnique({
    where: { userId_kind_refId_occursAt: { userId, kind, refId, occursAt } },
  });
  return Boolean(hit);
}

async function markSent(userId: string, kind: string, refId: string, occursAt: Date) {
  // Unique constraint guards against a duplicate from an overlapping scan.
  await prisma.sentReminder
    .create({ data: { userId, kind, refId, occursAt } })
    .catch(() => {});
}

async function remindLessons(userId: string, settings: Settings, now: Date, windowEnd: Date) {
  const periodTimes = lessonPeriodTimes(settings.daySchedule);
  // A lesson can only start "soon" today or (just past midnight) tomorrow.
  const days = [startOfLocalDay(now), startOfLocalDay(new Date(windowEnd.getTime()))];
  const uniqueDays = [...new Map(days.map((d) => [d.getTime(), d])).values()];

  const slots = await prisma.scheduleSlot.findMany({
    where: { userId, deletedAt: null },
    include: { class: { select: { name: true } } },
  });

  let pushed = 0;
  for (const day of uniqueDays) {
    for (const slot of slots) {
      if (!slotOccursOn(slot, day)) continue;
      const times = periodTimes[slot.period - 1];
      const start = times?.[0] ? wallTimeToInstant(day, times[0]) : null;
      if (!start) continue;
      if (start < now || start > windowEnd) continue;

      const occursAt = start;
      if (await alreadySent(userId, 'lesson', slot.id, occursAt)) continue;

      const mins = Math.round((start.getTime() - now.getTime()) / 60_000);
      const subject = slot.subject ?? '课程';
      const where = [slot.class?.name, slot.location].filter(Boolean).join(' · ');
      const delivered = await sendPushToUser(userId, {
        title: `${subject} 即将开始`,
        body: `${mins} 分钟后（第${slot.period}节 ${times?.[0]}）${where ? '，' + where : ''}`,
        tag: `lesson-${slot.id}-${formatDate(day)}`,
        url: '/schedule',
      }, scanLogger);
      await markSent(userId, 'lesson', slot.id, occursAt);
      if (delivered > 0) pushed += 1;
    }
  }
  return pushed;
}

async function remindTodos(userId: string, now: Date, windowEnd: Date, lead: number) {
  const events = await prisma.event.findMany({
    where: {
      userId,
      deletedAt: null,
      isDone: false,
      allDay: false,
      startAt: { gte: now, lte: windowEnd },
    },
    include: { class: { select: { name: true } } },
  });

  let pushed = 0;
  for (const ev of events) {
    if (await alreadySent(userId, 'event', ev.id, ev.startAt)) continue;
    const mins = Math.round((ev.startAt.getTime() - now.getTime()) / 60_000);
    const delivered = await sendPushToUser(userId, {
      title: `待办：${ev.title}`,
      body: `${mins <= 0 ? '现在' : mins + ' 分钟后'}开始${ev.class?.name ? '（' + ev.class.name + '）' : ''}`,
      tag: `event-${ev.id}`,
      url: '/',
    }, scanLogger);
    await markSent(userId, 'event', ev.id, ev.startAt);
    if (delivered > 0) pushed += 1;
  }
  void lead;
  return pushed;
}

function startOfLocalDay(instant: Date): Date {
  // Local calendar date of `instant`, returned as that date's UTC midnight —
  // the shape slotOccursOn / formatDate expect.
  const local = new Date(instant.getTime() + config.localTzOffsetMinutes * 60_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Delete ledger rows for occurrences more than a day old. */
async function pruneLedger(now: Date) {
  await prisma.sentReminder.deleteMany({
    where: { occursAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
  });
}

let timer: NodeJS.Timeout | null = null;

/** Start the periodic scan. No-op if already running or the interval is disabled. */
export function startReminderScheduler(logger?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  if (timer || config.reminderScanIntervalMs <= 0) return;
  scanLogger = logger;

  const tick = async () => {
    try {
      const now = new Date();
      const pushed = await runReminderScan(now);
      if (pushed > 0) logger?.info({ pushed }, 'reminder scan pushed notifications');
      await pruneLedger(now);
    } catch (err) {
      logger?.error({ err }, 'reminder scan failed');
    }
  };

  timer = setInterval(() => void tick(), config.reminderScanIntervalMs);
  // Don't hold the event loop open on shutdown.
  timer.unref?.();
}

export function stopReminderScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
