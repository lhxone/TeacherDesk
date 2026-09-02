import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireClass, requireSlot } from '../lib/ownership.js';
import { DEFAULT_SETTINGS } from '../config.js';
import {
  dateRange,
  formatDate,
  isoWeekday,
  projectRecurringEvent,
  recurringEventOccursOn,
  slotOccursOn,
  weekParity,
} from '../lib/schedule.js';
import {
  DEFAULT_DAY_SCHEDULE,
  lessonPeriodTimes,
  toMinutes,
  type DayScheduleItem,
} from '../lib/daySchedule.js';

const slotSchema = z.object({
  classId: z.string().uuid().nullable().optional(),
  subject: z.string().max(32).nullable().optional(),
  weekday: z.number().int().min(1).max(7),
  period: z.number().int().min(1).max(20),
  location: z.string().max(64).nullable().optional(),
  repeatRule: z.enum(['weekly', 'odd_week', 'even_week']).optional().default('weekly'),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

function serializeSlot(s: {
  id: string;
  classId: string | null;
  subject: string | null;
  weekday: number;
  period: number;
  location: string | null;
  repeatRule: string;
  startDate: Date | null;
  endDate: Date | null;
  note: string | null;
  class?: { name: string; color: string } | null;
}) {
  return {
    id: s.id,
    classId: s.classId,
    className: s.class?.name ?? null,
    classColor: s.class?.color ?? null,
    subject: s.subject,
    weekday: s.weekday,
    period: s.period,
    location: s.location,
    repeatRule: s.repeatRule,
    startDate: s.startDate ? formatDate(s.startDate) : null,
    endDate: s.endDate ? formatDate(s.endDate) : null,
    note: s.note,
  };
}

/**
 * A given weekday+period can hold only one lesson per repeat rule, but a
 * weekly lesson would collide with both odd- and even-week ones, so those
 * combinations are rejected too (ER.md §2.6).
 */
async function assertSlotFree(
  userId: string,
  weekday: number,
  period: number,
  repeatRule: string,
  excludeId?: string,
) {
  const conflictingRules =
    repeatRule === 'weekly'
      ? ['weekly', 'odd_week', 'even_week']
      : ['weekly', repeatRule];

  const clash = await prisma.scheduleSlot.findFirst({
    where: {
      userId,
      weekday,
      period,
      repeatRule: { in: conflictingRules },
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });

  if (clash) {
    throw ApiError.conflict(
      `周${weekday} 第${period}节 已存在课程安排（${clash.repeatRule}）`,
    );
  }
}

export async function registerScheduleRoutes(app: FastifyInstance) {
  app.get('/schedule/slots', async (req) => {
    const userId = requireUser(req);
    const q = z
      .object({ weekday: z.coerce.number().int().min(1).max(7).optional() })
      .parse(req.query);

    const slots = await prisma.scheduleSlot.findMany({
      where: { userId, deletedAt: null, ...(q.weekday ? { weekday: q.weekday } : {}) },
      orderBy: [{ weekday: 'asc' }, { period: 'asc' }],
      include: { class: { select: { name: true, color: true } } },
    });

    return { data: slots.map(serializeSlot) };
  });

  app.post('/schedule/slots', async (req, reply) => {
    const userId = requireUser(req);
    const body = slotSchema.parse(req.body);

    if (body.classId) await requireClass(body.classId, userId);
    await assertSlotFree(userId, body.weekday, body.period, body.repeatRule);

    const slot = await prisma.scheduleSlot.create({
      data: {
        userId,
        classId: body.classId ?? null,
        subject: body.subject ?? null,
        weekday: body.weekday,
        period: body.period,
        location: body.location ?? null,
        repeatRule: body.repeatRule,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        note: body.note ?? null,
      },
      include: { class: { select: { name: true, color: true } } },
    });

    return reply.status(201).send({ data: serializeSlot(slot) });
  });

  app.patch('/schedule/slots/:slotId', async (req) => {
    const userId = requireUser(req);
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(req.params);
    const body = slotSchema.partial().parse(req.body);
    const existing = await requireSlot(slotId, userId);

    if (body.classId) await requireClass(body.classId, userId);

    const weekday = body.weekday ?? existing.weekday;
    const period = body.period ?? existing.period;
    const repeatRule = body.repeatRule ?? existing.repeatRule;

    if (
      weekday !== existing.weekday ||
      period !== existing.period ||
      repeatRule !== existing.repeatRule
    ) {
      await assertSlotFree(userId, weekday, period, repeatRule, slotId);
    }

    const slot = await prisma.scheduleSlot.update({
      where: { id: slotId },
      data: {
        classId: body.classId,
        subject: body.subject,
        weekday: body.weekday,
        period: body.period,
        location: body.location,
        repeatRule: body.repeatRule,
        startDate: body.startDate ? new Date(body.startDate) : body.startDate === null ? null : undefined,
        endDate: body.endDate ? new Date(body.endDate) : body.endDate === null ? null : undefined,
        note: body.note,
      },
      include: { class: { select: { name: true, color: true } } },
    });

    return { data: serializeSlot(slot) };
  });

  app.delete('/schedule/slots/:slotId', async (req, reply) => {
    const userId = requireUser(req);
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(req.params);
    await requireSlot(slotId, userId);

    await prisma.scheduleSlot.update({
      where: { id: slotId },
      data: { deletedAt: new Date() },
    });

    return reply.status(204).send();
  });

  app.get('/schedule/agenda', async (req) => {
    const userId = requireUser(req);
    const q = z
      .object({
        date: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    if (!q.date && !(q.from && q.to)) {
      throw ApiError.validation('必须提供 date 或 from+to');
    }

    const from = new Date(q.date ?? (q.from as string));
    const to = new Date(q.date ?? (q.to as string));

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw ApiError.validation('日期格式不正确，应为 YYYY-MM-DD');
    }

    const days = dateRange(from, to);
    if (days.length > 31) throw ApiError.validation('日期区间最长 31 天');

    const [slots, events, recurringEvents, user] = await Promise.all([
      prisma.scheduleSlot.findMany({
        where: { userId, deletedAt: null },
        include: { class: { select: { name: true, color: true } } },
        orderBy: { period: 'asc' },
      }),
      prisma.event.findMany({
        where: {
          userId,
          deletedAt: null,
          repeatWeekday: null,
          startAt: {
            gte: new Date(`${formatDate(from)}T00:00:00.000Z`),
            lte: new Date(`${formatDate(to)}T23:59:59.999Z`),
          },
        },
        orderBy: { startAt: 'asc' },
      }),
      // Weekly-recurring todos: not filtered by the requested range here —
      // one could have started months ago and still recur into it — only
      // that its first occurrence isn't after the end of the range. Each
      // matching weekday within `days` gets projected below.
      prisma.event.findMany({
        where: {
          userId,
          deletedAt: null,
          repeatWeekday: { not: null },
          startAt: { lte: new Date(`${formatDate(to)}T23:59:59.999Z`) },
        },
      }),
      prisma.user.findFirstOrThrow({ where: { id: userId } }),
    ]);

    // Per-week completion overrides for the recurring events found above,
    // within the requested range — sparse (only weeks someone has toggled
    // away from the event's own isDone default get a row; see
    // EventOccurrence's doc comment).
    const occurrences = recurringEvents.length
      ? await prisma.eventOccurrence.findMany({
          where: {
            eventId: { in: recurringEvents.map((e) => e.id) },
            occurrenceDate: {
              gte: new Date(`${formatDate(from)}T00:00:00.000Z`),
              lte: new Date(`${formatDate(to)}T00:00:00.000Z`),
            },
          },
        })
      : [];
    const occurrenceIsDone = new Map(
      occurrences.map((o) => [`${o.eventId}:${formatDate(o.occurrenceDate)}`, o.isDone]),
    );

    const settings = { ...DEFAULT_SETTINGS, ...(user.settings as object) } as typeof DEFAULT_SETTINGS;
    const daySchedule: DayScheduleItem[] = settings.daySchedule?.length
      ? settings.daySchedule
      : DEFAULT_DAY_SCHEDULE;
    const periodTimes = lessonPeriodTimes(daySchedule);

    const data = days.map((day) => {
      const dayStr = formatDate(day);
      const daySlots = slots
        .filter((s) => slotOccursOn(s, day))
        .sort((a, b) => a.period - b.period);

      const termStart = daySlots.find((s) => s.startDate)?.startDate ?? null;
      const slotByPeriod = new Map(daySlots.map((s) => [s.period, s]));

      const lessons = daySlots.map((s) => {
        const times = periodTimes[s.period - 1];
        return {
          slotId: s.id,
          period: s.period,
          startTime: times?.[0] ?? null,
          endTime: times?.[1] ?? null,
          subject: s.subject,
          classId: s.classId,
          className: s.class?.name ?? null,
          classColor: s.class?.color ?? null,
          location: s.location,
        };
      });

      // One row per day-schedule block, in time order. Lesson blocks are merged
      // with that period's slot (if any) so the client renders both fixed
      // activities (早读 / 眼操 / 午餐 …) and scheduled lessons from one list.
      const timeline = [...daySchedule]
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
        .map((block) => {
          if (block.kind === 'activity') {
            return {
              kind: 'activity' as const,
              label: block.label,
              start: block.start,
              end: block.end,
            };
          }
          const s = block.period ? slotByPeriod.get(block.period) : undefined;
          return {
            kind: 'lesson' as const,
            label: block.label,
            start: block.start,
            end: block.end,
            period: block.period ?? null,
            slotId: s?.id ?? null,
            subject: s?.subject ?? null,
            classId: s?.classId ?? null,
            className: s?.class?.name ?? null,
            classColor: s?.class?.color ?? null,
            location: s?.location ?? null,
          };
        });

      const oneTimeEvents = events
        .filter((e) => formatDate(e.startAt) === dayStr)
        .map((e) => ({
          id: e.id,
          title: e.title,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt?.toISOString() ?? null,
          allDay: e.allDay,
          isDone: e.isDone,
          classId: e.classId,
          repeatWeekday: e.repeatWeekday,
          occurrenceDate: null as string | null,
        }));

      // Weekly-recurring todos occurring on this weekday get their
      // startAt/endAt projected onto this date (see projectRecurringEvent);
      // isDone comes from this week's EventOccurrence override if one
      // exists, else the event's own isDone default.
      const recurringOnDay = recurringEvents
        .filter((e) => recurringEventOccursOn(e, day))
        .map((e) => {
          const projected = projectRecurringEvent(e, day);
          const override = occurrenceIsDone.get(`${e.id}:${dayStr}`);
          return {
            id: e.id,
            title: e.title,
            startAt: projected.startAt.toISOString(),
            endAt: projected.endAt?.toISOString() ?? null,
            allDay: e.allDay,
            isDone: override ?? e.isDone,
            classId: e.classId,
            repeatWeekday: e.repeatWeekday,
            occurrenceDate: dayStr,
          };
        });

      return {
        date: dayStr,
        weekday: isoWeekday(day),
        weekParity: weekParity(day, termStart),
        lessons,
        timeline,
        events: [...oneTimeEvents, ...recurringOnDay].sort((a, b) => a.startAt.localeCompare(b.startAt)),
      };
    });

    return { data };
  });
}
