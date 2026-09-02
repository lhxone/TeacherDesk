import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, num } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireClass, requireExam, requireExamSession } from '../lib/ownership.js';
import { paginate, pageMeta } from '../lib/pagination.js';
import { formatDate } from '../lib/schedule.js';

const examTypeEnum = z.enum(['daily', 'unit', 'midterm', 'final']);

// One exam session (考试批次, e.g. "第一次月考") can cover several subjects at
// once; each becomes its own `exams` row so scoring/analytics stay per-subject.
const subjectSchema = z.object({
  subject: z.string().max(32).nullable().optional(),
  fullScore: z.number().positive().max(1000).optional().default(100),
  note: z.string().nullable().optional(),
});

const createSessionSchema = z.object({
  name: z.string().min(1, '考试名称不能为空').max(64),
  examType: examTypeEnum.optional().default('daily'),
  examDate: z.string(),
  note: z.string().nullable().optional(),
  subjects: z.array(subjectSchema).min(1, '至少选择一个科目'),
});

const updateSessionSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  examType: examTypeEnum.optional(),
  examDate: z.string().optional(),
  note: z.string().nullable().optional(),
});

const updateExamSchema = z.object({
  subject: z.string().max(32).nullable().optional(),
  fullScore: z.number().positive().max(1000).optional(),
  note: z.string().nullable().optional(),
});

function serializeExam(e: {
  id: string;
  classId: string;
  examSessionId: string;
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
    examSessionId: e.examSessionId,
    name: e.name,
    subject: e.subject,
    examType: e.examType,
    examDate: formatDate(e.examDate),
    fullScore: num(e.fullScore),
    note: e.note,
    stats: e.statsCache ?? null,
  };
}

function serializeSession(s: {
  id: string;
  classId: string;
  name: string;
  examType: string;
  examDate: Date;
  note: string | null;
}) {
  return {
    id: s.id,
    classId: s.classId,
    name: s.name,
    examType: s.examType,
    examDate: formatDate(s.examDate),
    note: s.note,
  };
}

export async function registerExamRoutes(app: FastifyInstance) {
  // Flat per-subject exam list — one row per scoreable Exam, same shape as
  // before exam sessions existed. Used by analytics (keyed on a single
  // examId) and the classroom tools' "balance by exam" grouping option.
  app.get('/classes/:classId/exams', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        subject: z.string().optional(),
        examType: examTypeEnum.optional(),
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

  // One row per exam session, each carrying its subject exams so the list
  // page can show "第一次月考 · 语文/数学/英语" without a second round trip.
  app.get('/classes/:classId/exam-sessions', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        examType: examTypeEnum.optional(),
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
      prisma.examSession.findMany({
        where,
        orderBy: { examDate: 'desc' },
        skip,
        take,
        include: {
          exams: {
            where: { deletedAt: null },
            include: {
              _count: { select: { scores: { where: { OR: [{ score: { not: null } }, { isAbsent: true }] } } } },
            },
          },
        },
      }),
      prisma.examSession.count({ where }),
      prisma.student.count({ where: { classId, deletedAt: null, status: 'active' } }),
    ]);

    return {
      data: rows.map((s) => ({
        ...serializeSession(s),
        exams: s.exams.map((e) => ({
          ...serializeExam(e),
          entryProgress: { entered: e._count.scores, total: studentCount },
        })),
      })),
      meta: pageMeta(q.page, q.pageSize, total),
    };
  });

  app.post('/classes/:classId/exam-sessions', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = createSessionSchema.parse(req.body);
    await requireClass(classId, userId);

    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.examSession.create({
        data: {
          classId,
          name: body.name.trim(),
          examType: body.examType,
          examDate: new Date(body.examDate),
          note: body.note ?? null,
        },
      });

      await tx.exam.createMany({
        data: body.subjects.map((sub) => ({
          classId,
          examSessionId: s.id,
          name: body.name.trim(),
          subject: sub.subject ?? null,
          examType: body.examType,
          examDate: new Date(body.examDate),
          fullScore: sub.fullScore,
          note: sub.note ?? null,
        })),
      });

      return s;
    });

    const exams = await prisma.exam.findMany({ where: { examSessionId: session.id } });

    return reply.status(201).send({
      data: { ...serializeSession(session), exams: exams.map(serializeExam) },
    });
  });

  app.get('/exam-sessions/:examSessionId', async (req) => {
    const userId = requireUser(req);
    const { examSessionId } = z.object({ examSessionId: z.string().uuid() }).parse(req.params);
    const session = await requireExamSession(examSessionId, userId);
    const exams = await prisma.exam.findMany({
      where: { examSessionId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return {
      data: {
        ...serializeSession(session),
        className: session.class.name,
        exams: exams.map(serializeExam),
      },
    };
  });

  // Renames the session and, when name/examType/examDate change, cascades
  // those onto every subject exam so they stay in sync (they're denormalized
  // onto `exams` for scoring/analytics that key off a single exam row).
  app.patch('/exam-sessions/:examSessionId', async (req) => {
    const userId = requireUser(req);
    const { examSessionId } = z.object({ examSessionId: z.string().uuid() }).parse(req.params);
    const body = updateSessionSchema.parse(req.body);
    await requireExamSession(examSessionId, userId);

    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.examSession.update({
        where: { id: examSessionId },
        data: {
          name: body.name?.trim(),
          examType: body.examType,
          examDate: body.examDate ? new Date(body.examDate) : undefined,
          note: body.note,
        },
      });

      if (body.name !== undefined || body.examType !== undefined || body.examDate !== undefined) {
        await tx.exam.updateMany({
          where: { examSessionId },
          data: {
            name: body.name?.trim(),
            examType: body.examType,
            examDate: body.examDate ? new Date(body.examDate) : undefined,
          },
        });
      }

      return s;
    });

    const exams = await prisma.exam.findMany({ where: { examSessionId, deletedAt: null } });
    return { data: { ...serializeSession(session), exams: exams.map(serializeExam) } };
  });

  app.delete('/exam-sessions/:examSessionId', async (req, reply) => {
    const userId = requireUser(req);
    const { examSessionId } = z.object({ examSessionId: z.string().uuid() }).parse(req.params);
    await requireExamSession(examSessionId, userId);

    const now = new Date();
    await prisma.$transaction([
      prisma.examSession.update({ where: { id: examSessionId }, data: { deletedAt: now } }),
      prisma.exam.updateMany({ where: { examSessionId }, data: { deletedAt: now } }),
    ]);
    return reply.status(204).send();
  });

  // Add one more subject to an existing session (e.g. add 英语 after the
  // session was created with just 语文/数学).
  app.post('/exam-sessions/:examSessionId/exams', async (req, reply) => {
    const userId = requireUser(req);
    const { examSessionId } = z.object({ examSessionId: z.string().uuid() }).parse(req.params);
    const body = subjectSchema.parse(req.body);
    const session = await requireExamSession(examSessionId, userId);

    const exam = await prisma.exam.create({
      data: {
        classId: session.classId,
        examSessionId,
        name: session.name,
        subject: body.subject ?? null,
        examType: session.examType,
        examDate: session.examDate,
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

  // Per-subject fields only (subject/fullScore/note). Name/type/date live on
  // the session — edit those via PATCH /exam-sessions/:id.
  app.patch('/exams/:examId', async (req) => {
    const userId = requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    const body = updateExamSchema.parse(req.body);
    await requireExam(examId, userId);

    const exam = await prisma.exam.update({
      where: { id: examId },
      data: {
        subject: body.subject,
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
    const exam = await requireExam(examId, userId);

    const remaining = await prisma.exam.count({
      where: { examSessionId: exam.examSessionId, deletedAt: null, id: { not: examId } },
    });
    if (remaining === 0) {
      throw ApiError.businessRule('考试至少需要保留一个科目，删除整场考试请使用「删除考试」');
    }

    await prisma.exam.update({ where: { id: examId }, data: { deletedAt: new Date() } });
    return reply.status(204).send();
  });
}
