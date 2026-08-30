import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, num } from '../db.js';
import { requireUser } from '../app.js';
import { requireClass, requireExam } from '../lib/ownership.js';
import { paginate, pageMeta } from '../lib/pagination.js';
import { formatDate } from '../lib/schedule.js';

const createSchema = z.object({
  name: z.string().min(1, '考试名称不能为空').max(64),
  subject: z.string().max(32).nullable().optional(),
  examType: z.enum(['daily', 'unit', 'midterm', 'final']).optional().default('daily'),
  examDate: z.string(),
  fullScore: z.number().positive().max(1000).optional().default(100),
  note: z.string().nullable().optional(),
});

function serializeExam(e: {
  id: string;
  classId: string;
  name: string;
  subject: string | null;
  examType: string;
  examDate: Date;
  fullScore: unknown;
  note: string | null;
  statsCache: unknown;
}) {
  return {
    id: e.id,
    classId: e.classId,
    name: e.name,
    subject: e.subject,
    examType: e.examType,
    examDate: formatDate(e.examDate),
    fullScore: num(e.fullScore),
    note: e.note,
    stats: e.statsCache ?? null,
  };
}

export async function registerExamRoutes(app: FastifyInstance) {
  app.get('/classes/:classId/exams', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        subject: z.string().optional(),
        examType: z.enum(['daily', 'unit', 'midterm', 'final']).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(req.query);

    await requireClass(classId, userId);

    const where = {
      classId,
      deletedAt: null,
      ...(q.subject ? { subject: q.subject } : {}),
      ...(q.examType ? { examType: q.examType } : {}),
      ...(q.from || q.to
        ? {
            examDate: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const { skip, take } = paginate(q.page, q.pageSize);
    const [rows, total, studentCount] = await Promise.all([
      prisma.exam.findMany({
        where,
        orderBy: { examDate: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { scores: { where: { OR: [{ score: { not: null } }, { isAbsent: true }] } } } },
        },
      }),
      prisma.exam.count({ where }),
      prisma.student.count({ where: { classId, deletedAt: null, status: 'active' } }),
    ]);

    return {
      data: rows.map((e) => ({
        ...serializeExam(e),
        entryProgress: { entered: e._count.scores, total: studentCount },
      })),
      meta: pageMeta(q.page, q.pageSize, total),
    };
  });

  app.post('/classes/:classId/exams', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = createSchema.parse(req.body);
    await requireClass(classId, userId);

    const exam = await prisma.exam.create({
      data: {
        classId,
        name: body.name.trim(),
        subject: body.subject ?? null,
        examType: body.examType,
        examDate: new Date(body.examDate),
        fullScore: body.fullScore,
        note: body.note ?? null,
      },
    });

    return reply.status(201).send({ data: serializeExam(exam) });
  });

  app.get('/exams/:examId', async (req) => {
    const userId = requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    const exam = await requireExam(examId, userId);
    return { data: { ...serializeExam(exam), className: exam.class.name } };
  });

  app.patch('/exams/:examId', async (req) => {
    const userId = requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    const body = createSchema.partial().parse(req.body);
    await requireExam(examId, userId);

    const exam = await prisma.exam.update({
      where: { id: examId },
      data: {
        name: body.name?.trim(),
        subject: body.subject,
        examType: body.examType,
        examDate: body.examDate ? new Date(body.examDate) : undefined,
        fullScore: body.fullScore,
        note: body.note,
        // Changing fullScore invalidates cached rates; recomputed on next read.
        statsCache: body.fullScore !== undefined ? Prisma.DbNull : undefined,
      },
    });

    return { data: serializeExam(exam) };
  });

  app.delete('/exams/:examId', async (req, reply) => {
    const userId = requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    await requireExam(examId, userId);

    await prisma.exam.update({ where: { id: examId }, data: { deletedAt: new Date() } });
    return reply.status(204).send();
  });
}
