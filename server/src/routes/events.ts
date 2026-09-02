import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireClass, requireEvent } from '../lib/ownership.js';
import { paginate, pageMeta } from '../lib/pagination.js';

const createSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(128),
  description: z.string().nullable().optional(),
  startAt: z.string(),
  endAt: z.string().nullable().optional(),
  allDay: z.boolean().optional().default(false),
  classId: z.string().uuid().nullable().optional(),
  // 1 = Monday … 7 = Sunday. Non-null makes this a weekly-recurring todo
  // (e.g. "每周三值班"): startAt/endAt's time-of-day repeats every week from
  // startAt's date onward; the agenda endpoint projects each occurrence.
  repeatWeekday: z.number().int().min(1).max(7).nullable().optional(),
});

function serializeEvent(e: {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  isDone: boolean;
  classId: string | null;
  repeatWeekday: number | null;
  class?: { name: string; color: string } | null;
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt?.toISOString() ?? null,
    allDay: e.allDay,
    isDone: e.isDone,
    classId: e.classId,
    repeatWeekday: e.repeatWeekday,
    className: e.class?.name ?? null,
    classColor: e.class?.color ?? null,
  };
}

export async function registerEventRoutes(app: FastifyInstance) {
  app.get('/events', async (req) => {
    const userId = requireUser(req);
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        classId: z.string().uuid().optional(),
        isDone: z.enum(['true', 'false']).optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
      })
      .parse(req.query);

    const where = {
      userId,
      deletedAt: null,
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.isDone ? { isDone: q.isDone === 'true' } : {}),
      ...(q.from || q.to
        ? {
            startAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const { skip, take } = paginate(q.page, q.pageSize);
    const [rows, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { startAt: 'asc' },
        skip,
        take,
        include: { class: { select: { name: true, color: true } } },
      }),
      prisma.event.count({ where }),
    ]);

    return { data: rows.map(serializeEvent), meta: pageMeta(q.page, q.pageSize, total) };
  });

  app.post('/events', async (req, reply) => {
    const userId = requireUser(req);
    const body = createSchema.parse(req.body);

    if (body.classId) await requireClass(body.classId, userId);

    const event = await prisma.event.create({
      data: {
        userId,
        classId: body.classId ?? null,
        title: body.title.trim(),
        description: body.description ?? null,
        startAt: new Date(body.startAt),
        endAt: body.endAt ? new Date(body.endAt) : null,
        allDay: body.allDay,
        repeatWeekday: body.repeatWeekday ?? null,
      },
      include: { class: { select: { name: true, color: true } } },
    });

    return reply.status(201).send({ data: serializeEvent(event) });
  });

  app.patch('/events/:eventId', async (req) => {
    const userId = requireUser(req);
    const { eventId } = z.object({ eventId: z.string().uuid() }).parse(req.params);
    const body = createSchema.partial().extend({ isDone: z.boolean().optional() }).parse(req.body);

    const existing = await requireEvent(eventId, userId);
    if (body.classId) await requireClass(body.classId, userId);

    // A recurring event's completion is tracked per week (EventOccurrence),
    // not on the event row itself — route isDone toggles there instead so a
    // client can't accidentally flip every week at once via this endpoint.
    const recurring = body.repeatWeekday !== undefined ? body.repeatWeekday !== null : existing.repeatWeekday !== null;
    if (body.isDone !== undefined && recurring) {
      throw ApiError.validation('重复待办的完成状态请通过 /events/{id}/occurrences/{date} 按次修改');
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        classId: body.classId,
        title: body.title?.trim(),
        description: body.description,
        startAt: body.startAt ? new Date(body.startAt) : undefined,
        endAt: body.endAt ? new Date(body.endAt) : body.endAt === null ? null : undefined,
        allDay: body.allDay,
        isDone: body.isDone,
        repeatWeekday:
          body.repeatWeekday !== undefined ? body.repeatWeekday : undefined,
      },
      include: { class: { select: { name: true, color: true } } },
    });

    return { data: serializeEvent(event) };
  });

  // Toggles one week's completion for a recurring event without touching any
  // other week's — the sparse EventOccurrence row this creates/updates only
  // covers `date`.
  app.patch('/events/:eventId/occurrences/:date', async (req) => {
    const userId = requireUser(req);
    const { eventId, date } = z
      .object({ eventId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD') })
      .parse(req.params);
    const { isDone } = z.object({ isDone: z.boolean() }).parse(req.body);

    const event = await requireEvent(eventId, userId);
    if (event.repeatWeekday == null) {
      throw ApiError.validation('该待办不是重复事项，请直接 PATCH /events/{id}');
    }

    const occurrence = await prisma.eventOccurrence.upsert({
      where: { eventId_occurrenceDate: { eventId, occurrenceDate: new Date(`${date}T00:00:00.000Z`) } },
      create: { eventId, occurrenceDate: new Date(`${date}T00:00:00.000Z`), isDone },
      update: { isDone },
    });

    return { data: { eventId, occurrenceDate: date, isDone: occurrence.isDone } };
  });

  app.delete('/events/:eventId', async (req, reply) => {
    const userId = requireUser(req);
    const { eventId } = z.object({ eventId: z.string().uuid() }).parse(req.params);
    await requireEvent(eventId, userId);

    await prisma.event.update({ where: { id: eventId }, data: { deletedAt: new Date() } });
    return reply.status(204).send();
  });
}
