import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, num } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireClass, requireExam, requireStudent } from '../lib/ownership.js';
import { thresholdsFor } from './scores.js';
import { formatDate } from '../lib/schedule.js';
import {
  distribution,
  gradeRatio,
  mean,
  rank,
  stddev,
  summarize,
  zScore,
  type ScoreInput,
} from '../lib/stats.js';

type ScoreRow = { studentId: string; score: unknown; isAbsent: boolean };

function toInputs(rows: ScoreRow[]): ScoreInput[] {
  return rows.map((r) => ({
    studentId: r.studentId,
    score: num(r.score),
    isAbsent: r.isAbsent,
  }));
}

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.get('/analytics/class/:classId/exam/:examId', async (req) => {
    const userId = requireUser(req);
    const { classId, examId } = z
      .object({ classId: z.string().uuid(), examId: z.string().uuid() })
      .parse(req.params);
    const q = z
      .object({ bucketSize: z.coerce.number().int().min(1).max(50).optional().default(10) })
      .parse(req.query);

    await requireClass(classId, userId);
    const exam = await requireExam(examId, userId);
    if (exam.classId !== classId) throw ApiError.forbidden();

    const fullScore = num(exam.fullScore) ?? 100;
    const [scores, students, thresholds] = await Promise.all([
      prisma.score.findMany({ where: { examId } }),
      prisma.student.findMany({
        where: { classId, deletedAt: null },
        select: { id: true, name: true, studentNo: true },
      }),
      thresholdsFor(userId),
    ]);

    const inputs = toInputs(scores);
    const ranked = rank(inputs);
    const nameById = new Map(students.map((s) => [s.id, s]));

    // Previous exam of the same subject gives the rank delta shown as an
    // up/down arrow in the ranking table (PRD §3.7.3).
    const prevExam = await prisma.exam.findFirst({
      where: {
        classId,
        deletedAt: null,
        subject: exam.subject,
        examDate: { lt: exam.examDate },
      },
      orderBy: { examDate: 'desc' },
    });

    let prevRankById = new Map<string, number>();
    if (prevExam) {
      const prevScores = await prisma.score.findMany({ where: { examId: prevExam.id } });
      prevRankById = new Map(rank(toInputs(prevScores)).map((r) => [r.studentId, r.rank]));
    }

    return {
      data: {
        exam: {
          id: exam.id,
          name: exam.name,
          subject: exam.subject,
          examDate: formatDate(exam.examDate),
          fullScore,
        },
        summary: summarize(inputs, fullScore, thresholds),
        distribution: distribution(inputs, fullScore, q.bucketSize),
        gradeRatio: gradeRatio(inputs, fullScore, thresholds),
        ranking: ranked.map((r) => {
          const prev = prevRankById.get(r.studentId);
          return {
            rank: r.rank,
            studentId: r.studentId,
            studentName: nameById.get(r.studentId)?.name ?? null,
            studentNo: nameById.get(r.studentId)?.studentNo ?? null,
            score: r.score,
            previousRank: prev ?? null,
            // Positive = moved up. Null when there is no comparable prior exam.
            rankDelta: prev !== undefined ? prev - r.rank : null,
          };
        }),
      },
    };
  });

  app.get('/analytics/class/:classId/trend', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        subject: z.string().optional(),
        examType: z.enum(['daily', 'unit', 'midterm', 'final']).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(req.query);

    await requireClass(classId, userId);
    const thresholds = await thresholdsFor(userId);

    const exams = await prisma.exam.findMany({
      where: {
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
      },
      orderBy: { examDate: 'asc' },
      take: q.limit,
      include: { scores: true },
    });

    return {
      data: {
        series: exams.map((e) => {
          const s = summarize(toInputs(e.scores), num(e.fullScore) ?? 100, thresholds);
          return {
            examId: e.id,
            examName: e.name,
            examDate: formatDate(e.examDate),
            subject: e.subject,
            fullScore: num(e.fullScore),
            avg: s.avg,
            max: s.max,
            min: s.min,
            median: s.median,
            stddev: s.stddev,
            passRate: s.passRate,
            excellentRate: s.excellentRate,
            attended: s.attended,
          };
        }),
      },
    };
  });

  app.get('/analytics/class/compare', async (req) => {
    const userId = requireUser(req);
    const q = z
      .object({
        classIds: z.string(),
        examName: z.string().optional(),
        subject: z.string().optional(),
      })
      .parse(req.query);

    const classIds = q.classIds.split(',').filter(Boolean);
    if (classIds.length === 0) throw ApiError.validation('classIds 不能为空');
    if (classIds.length > 10) throw ApiError.validation('最多对比 10 个班级');

    await Promise.all(classIds.map((id) => requireClass(id, userId)));
    const thresholds = await thresholdsFor(userId);

    const classes = await prisma.class.findMany({
      where: { id: { in: classIds }, deletedAt: null },
      select: { id: true, name: true },
    });

    const exams = await prisma.exam.findMany({
      where: {
        classId: { in: classIds },
        deletedAt: null,
        ...(q.examName ? { name: q.examName } : {}),
        ...(q.subject ? { subject: q.subject } : {}),
      },
      orderBy: { examDate: 'desc' },
      include: { scores: true },
    });

    // One exam per class: the most recent match, so classes that sat the same
    // paper on slightly different dates still line up.
    const byClass = new Map<string, (typeof exams)[number]>();
    for (const e of exams) if (!byClass.has(e.classId)) byClass.set(e.classId, e);

    return {
      data: {
        examName: q.examName ?? null,
        subject: q.subject ?? null,
        classes: classes.map((c) => {
          const exam = byClass.get(c.id);
          if (!exam) {
            return {
              classId: c.id,
              className: c.name,
              examId: null,
              avg: null,
              passRate: null,
              excellentRate: null,
              attended: 0,
            };
          }
          const s = summarize(toInputs(exam.scores), num(exam.fullScore) ?? 100, thresholds);
          return {
            classId: c.id,
            className: c.name,
            examId: exam.id,
            examName: exam.name,
            examDate: formatDate(exam.examDate),
            avg: s.avg,
            max: s.max,
            min: s.min,
            passRate: s.passRate,
            excellentRate: s.excellentRate,
            attended: s.attended,
          };
        }),
      },
    };
  });

  app.get('/analytics/student/:studentId', async (req) => {
    const userId = requireUser(req);
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        subject: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(req.query);

    const student = await requireStudent(studentId, userId);

    const exams = await prisma.exam.findMany({
      where: {
        classId: student.classId,
        deletedAt: null,
        ...(q.subject ? { subject: q.subject } : {}),
        scores: { some: { studentId } },
      },
      orderBy: { examDate: 'asc' },
      take: q.limit,
      include: { scores: true },
    });

    const trend = exams
      .map((e) => {
        const own = e.scores.find((s) => s.studentId === studentId);
        const ownScore = num(own?.score);
        if (!own || own.isAbsent || ownScore === null) return null;

        const inputs = toInputs(e.scores);
        const classValues = inputs
          .filter((i) => !i.isAbsent && i.score !== null)
          .map((i) => i.score as number);
        const classAvg = mean(classValues);
        const classSd = stddev(classValues);
        const ranked = rank(inputs);
        const myRank = ranked.find((r) => r.studentId === studentId)?.rank ?? null;

        return {
          examId: e.id,
          examName: e.name,
          examDate: formatDate(e.examDate),
          subject: e.subject,
          score: ownScore,
          fullScore: num(e.fullScore),
          classAvg,
          rank: myRank,
          totalStudents: ranked.length,
          zScore: classAvg !== null && classSd !== null ? zScore(ownScore, classAvg, classSd) : 0,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const own = trend.map((t) => t.score);
    const ranks = trend.map((t) => t.rank).filter((r): r is number => r !== null);

    // Radar uses the latest exam per subject, z-scored so different subjects
    // and full scores are comparable (PRD §3.7.4).
    const latestBySubject = new Map<string, (typeof trend)[number]>();
    for (const t of trend) {
      const key = t.subject ?? '未分科';
      const prev = latestBySubject.get(key);
      if (!prev || t.examDate > prev.examDate) latestBySubject.set(key, t);
    }

    return {
      data: {
        student: {
          id: student.id,
          name: student.name,
          studentNo: student.studentNo,
          classId: student.classId,
          className: student.class.name,
        },
        summary: {
          examCount: trend.length,
          avgScore: mean(own),
          bestScore: own.length ? Math.max(...own) : null,
          worstScore: own.length ? Math.min(...own) : null,
          stddev: stddev(own),
          avgRank: ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
          bestRank: ranks.length ? Math.min(...ranks) : null,
        },
        trend,
        subjectRadar: [...latestBySubject.entries()].map(([subject, t]) => ({
          subject,
          score: t.score,
          classAvg: t.classAvg,
          zScore: t.zScore,
        })),
      },
    };
  });
}
