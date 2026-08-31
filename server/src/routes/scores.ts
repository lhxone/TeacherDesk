import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, num } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireExam } from '../lib/ownership.js';
import { summarize, type GradeThresholds } from '../lib/stats.js';
import { DEFAULT_SETTINGS } from '../config.js';
import {
  buildTemplateWorkbook,
  xlsxAttachment,
  readTemplateRows,
  requireUploadedFile,
} from '../lib/excel.js';

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

  // Excel template pre-filled with the current roster + any entered scores,
  // for the teacher to fill in offline and re-upload via import-file below.
  app.get('/exams/:examId/scores/template', async (req, reply) => {
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

    const columns = [
      { header: '学号', key: 'no', width: 12 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '分数', key: 'score', width: 10 },
      { header: '缺考（是/否）', key: 'absent', width: 14 },
    ];
    const rows = students.map((st) => {
      const s = byStudent.get(st.id);
      return {
        no: st.studentNo ?? '',
        name: st.name,
        score: s && !s.isAbsent ? (num(s.score) ?? '') : '',
        absent: s?.isAbsent ? '是' : '',
      };
    });

    const buffer = await buildTemplateWorkbook(
      '成绩导入模板',
      `${exam.name} · 成绩导入模板`,
      columns,
      rows,
    );

    const filename = `${exam.name}-成绩模板.xlsx`;
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', xlsxAttachment(filename))
      .send(buffer);
  });

  // Parses an uploaded filled-in template and returns matched score updates;
  // the client merges these into its in-memory grid — nothing is persisted
  // here, so the teacher still reviews and clicks "保存成绩" (PUT above).
  app.post('/exams/:examId/scores/import-file', async (req) => {
    const userId = requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    const exam = await requireExam(examId, userId);
    const fullScore = num(exam.fullScore) ?? 100;

    const students = await prisma.student.findMany({
      where: { classId: exam.classId, deletedAt: null, status: 'active' },
      select: { id: true, name: true, studentNo: true },
    });
    const byNo = new Map(students.filter((s) => s.studentNo).map((s) => [s.studentNo as string, s]));
    const byName = new Map(students.map((s) => [s.name, s]));

    const file = await requireUploadedFile(req);
    const rows = await readTemplateRows(file);
    if (!rows.length) throw ApiError.validation('模板文件为空');

    const matched: { studentId: string; score: number | null; isAbsent: boolean }[] = [];
    const skipped: string[] = [];

    for (const [no, name, scoreText, absentText] of rows) {
      const student = (no && byNo.get(no)) || (name && byName.get(name));
      if (!student) {
        if (no || name) skipped.push(name || no);
        continue;
      }

      const absent = ['是', 'y', 'yes', 'true', '1'].includes((absentText ?? '').trim().toLowerCase());
      const trimmed = (scoreText ?? '').trim();
      if (absent || trimmed === '' || trimmed === '缺考') {
        matched.push({ studentId: student.id, score: null, isAbsent: true });
        continue;
      }

      const n = Number(trimmed);
      if (Number.isNaN(n)) {
        skipped.push(student.name);
        continue;
      }
      if (n > fullScore) {
        throw ApiError.validation('分数超出满分', [
          { field: student.name, message: `分数 ${n} 超过满分 ${fullScore}` },
        ]);
      }
      matched.push({ studentId: student.id, score: n, isAbsent: false });
    }

    if (!matched.length) {
      throw ApiError.validation('未匹配到任何学生，请确认使用的是本考试导出的模板');
    }

    return { data: { matched: matched.length, skipped, scores: matched } };
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
