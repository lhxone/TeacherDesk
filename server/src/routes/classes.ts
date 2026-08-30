import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, num } from '../db.js';
import { requireUser } from '../app.js';
import { requireClass } from '../lib/ownership.js';
import { paginate, pageMeta } from '../lib/pagination.js';

const createSchema = z.object({
  name: z.string().min(1, '班级名称不能为空').max(64),
  subject: z.string().max(32).nullable().optional(),
  academicYear: z.string().min(1, '学年不能为空').max(16),
  color: z.string().max(16).optional(),
  note: z.string().nullable().optional(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
});

export async function registerClassRoutes(app: FastifyInstance) {
  app.get('/classes', async (req) => {
    const userId = requireUser(req);
    const q = z
      .object({
        status: z.enum(['active', 'archived', 'all']).optional().default('active'),
        academicYear: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(req.query);

    const where = {
      userId,
      deletedAt: null,
      ...(q.status === 'all' ? {} : { status: q.status }),
      ...(q.academicYear ? { academicYear: q.academicYear } : {}),
    };

    const { skip, take } = paginate(q.page, q.pageSize);
    const [rows, total] = await Promise.all([
      prisma.class.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { students: { where: { deletedAt: null } } } },
          exams: {
            where: { deletedAt: null },
            orderBy: { examDate: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.class.count({ where }),
    ]);

    return {
      data: rows.map((c) => {
        const latest = c.exams[0];
        const stats = latest?.statsCache as { avg?: number } | null;
        return {
          id: c.id,
          name: c.name,
          subject: c.subject,
          academicYear: c.academicYear,
          color: c.color,
          note: c.note,
          status: c.status,
          studentCount: c._count.students,
          latestExam: latest
            ? {
                id: latest.id,
                name: latest.name,
                avg: stats?.avg ?? null,
                examDate: latest.examDate.toISOString().slice(0, 10),
              }
            : null,
          createdAt: c.createdAt.toISOString(),
        };
      }),
      meta: pageMeta(q.page, q.pageSize, total),
    };
  });

  app.post('/classes', async (req, reply) => {
    const userId = requireUser(req);
    const body = createSchema.parse(req.body);

    const cls = await prisma.class.create({
      data: {
        userId,
        name: body.name.trim(),
        subject: body.subject ?? null,
        academicYear: body.academicYear,
        color: body.color ?? '#3B82F6',
        note: body.note ?? null,
      },
    });

    return reply.status(201).send({ data: serializeClass(cls, 0) });
  });

  app.get('/classes/:classId', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    await requireClass(classId, userId);

    const cls = await prisma.class.findFirstOrThrow({
      where: { id: classId },
      include: { _count: { select: { students: { where: { deletedAt: null } } } } },
    });

    return { data: serializeClass(cls, cls._count.students) };
  });

  app.patch('/classes/:classId', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    await requireClass(classId, userId);

    const cls = await prisma.class.update({
      where: { id: classId },
      data: {
        name: body.name?.trim(),
        subject: body.subject,
        academicYear: body.academicYear,
        color: body.color,
        note: body.note,
        status: body.status,
      },
      include: { _count: { select: { students: { where: { deletedAt: null } } } } },
    });

    return { data: serializeClass(cls, cls._count.students) };
  });

  app.delete('/classes/:classId', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    await requireClass(classId, userId);

    // Soft delete. Students/exams/charts stay in the DB but every read path
    // filters on `class.deletedAt: null`, so they become unreachable (AC-3).
    await prisma.class.update({
      where: { id: classId },
      data: { deletedAt: new Date() },
    });

    return reply.status(204).send();
  });
}

function serializeClass(c: Record<string, unknown>, studentCount: number) {
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    academicYear: c.academicYear,
    color: c.color,
    note: c.note,
    status: c.status,
    studentCount,
    createdAt: (c.createdAt as Date).toISOString(),
  };
}
