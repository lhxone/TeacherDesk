import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, num } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireExam } from '../lib/ownership.js';
import { summarize, type GradeThresholds } from '../lib/stats.js';
import { DEFAULT_SETTINGS } from '../config.js';

export async function thresholdsFor(userId: string): Promise<GradeThresholds> {
  const user = await prisma.user.findFirst({ where: { id: userId } });
  const settings = { ...DEFAULT_SETTINGS, ...((user?.settings as object) ?? {}) };
  return settings.gradeThresholds as GradeThresholds;
}

/**
 * Recompute and persist exams.stats_cache. Called after every write so that
 * list/analytics reads can serve the snapshot without re-aggregating.
 */
export async function refreshExamStats(examId: string, userId: string) {
  const exam = await prisma.exam.findFirstOrThrow({ where: { id: examId } });
  const [scores, thresholds] = await Promise.all([
    prisma.score.findMany({ where: { examId } }),
    thresholdsFor(userId),
  ]);

  const summary = summarize(
    scores.map((s) => ({
      studentId: s.studentId,
      score: num(s.score),
      isAbsent: s.isAbsent,
    })),
    num(exam.fullScore) ?? 100,
    thresholds,
  );

  const cache = { ...summary, count: summary.attended, computedAt: new Date().toISOString() };

  await prisma.exam.update({ where: { id: examId }, data: { statsCache: cache } });
  return cache;
}

export async function registerScoreRoutes(app: FastifyInstance) {
  app.get('/exams/:examId/scores', async (req) => {
    const userId = requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    const exam = await requireExam(examId, userId);

    const [students, scores] = await Promise.all([
      prisma.student.findMany({
        where: { classId: exam.classId, deletedAt: null, status: 'active' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.score.findMany({ where: { examId } }),
    ]);

    const byStudent = new Map(scores.map((s) => [s.studentId, s]));

    return {
      data: {
        exam: {
          id: exam.id,
          name: exam.name,
          subject: exam.subject,
          fullScore: num(exam.fullScore),
          examDate: exam.examDate.toISOString().slice(0, 10),
        },
        // Every active student appears, entered or not, so the entry grid is
        // complete without the client having to merge two lists.
        scores: students.map((st) => {
          const s = byStudent.get(st.id);
          return {
            studentId: st.id,
            studentName: st.name,
            studentNo: st.studentNo,
            score: s ? num(s.score) : null,
            isAbsent: s?.isAbsent ?? false,
            comment: s?.comment ?? null,
          };
        }),
      },
    };
  });

  app.put('/exams/:examId/scores', async (req) => {
    const userId = requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        scores: z.array(
          z.object({
            studentId: z.string().uuid(),
            score: z.number().min(0).nullable().optional(),
            isAbsent: z.boolean().optional().default(false),
            comment: z.string().nullable().optional(),
          }),
        ),
      })
      .parse(req.body);

    const exam = await requireExam(examId, userId);
    const fullScore = num(exam.fullScore) ?? 100;

    const ids = body.scores.map((s) => s.studentId);
    const valid = await prisma.student.count({
      where: { id: { in: ids }, classId: exam.classId, deletedAt: null },
    });
    if (valid !== new Set(ids).size) throw ApiError.forbidden('包含不属于该班级的学生');

    for (const s of body.scores) {
      if (s.score !== null && s.score !== undefined && s.score > fullScore) {
        throw ApiError.validation('分数超出满分', [
          { field: s.studentId, message: `分数 ${s.score} 超过满分 ${fullScore}` },
        ]);
      }
    }

    // Upsert semantics: students omitted from the payload keep their existing
    // score (API.md §10 PUT).
    await prisma.$transaction(
      body.scores.map((s) =>
        prisma.score.upsert({
          where: { examId_studentId: { examId, studentId: s.studentId } },
          create: {
            examId,
            studentId: s.studentId,
            score: s.score ?? null,
            isAbsent: s.isAbsent,
            comment: s.comment ?? null,
          },
          update: {
            score: s.score ?? null,
            isAbsent: s.isAbsent,
            comment: s.comment ?? null,
          },
        }),
      ),
    );

    const stats = await refreshExamStats(examId, userId);
    return { data: { saved: body.scores.length, stats } };
  });

  app.patch('/exams/:examId/scores/:studentId', async (req) => {
    const userId = requireUser(req);
    const { examId, studentId } = z
      .object({ examId: z.string().uuid(), studentId: z.string().uuid() })
      .parse(req.params);
    const body = z
      .object({
        score: z.number().min(0).nullable().optional(),
        isAbsent: z.boolean().optional(),
        comment: z.string().nullable().optional(),
      })
      .parse(req.body);

    const exam = await requireExam(examId, userId);
    const fullScore = num(exam.fullScore) ?? 100;

    const student = await prisma.student.findFirst({
      where: { id: studentId, classId: exam.classId, deletedAt: null },
    });
    if (!student) throw ApiError.forbidden('该学生不属于本班级');

    if (body.score !== null && body.score !== undefined && body.score > fullScore) {
      throw ApiError.validation('分数超出满分', [
        { field: 'score', message: `分数 ${body.score} 超过满分 ${fullScore}` },
      ]);
    }

    const saved = await prisma.score.upsert({
      where: { examId_studentId: { examId, studentId } },
      create: {
        examId,
        studentId,
        score: body.score ?? null,
        isAbsent: body.isAbsent ?? false,
        comment: body.comment ?? null,
      },
      update: {
        score: body.score,
        isAbsent: body.isAbsent,
        comment: body.comment,
      },
    });

    const stats = await refreshExamStats(examId, userId);

    return {
      data: {
        studentId,
        score: num(saved.score),
        isAbsent: saved.isAbsent,
        comment: saved.comment,
        stats,
      },
    };
  });
}
