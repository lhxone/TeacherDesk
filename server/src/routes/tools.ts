import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireClass, requireGroupingPlan } from '../lib/ownership.js';
import { draw } from '../lib/lottery.js';
import { generateGroups } from '../lib/grouping.js';
import { paginate, pageMeta } from '../lib/pagination.js';

/**
 * A "round" for noRepeat mode is the window since the most recent reset.
 * Resets are recorded as a marker row with mode='reset' and no student, so the
 * round boundary survives restarts without extra state.
 */
async function roundStartedAt(classId: string): Promise<Date | null> {
  const marker = await prisma.lotteryRecord.findFirst({
    where: { classId, mode: 'reset' },
    orderBy: { createdAt: 'desc' },
  });
  return marker?.createdAt ?? null;
}

export async function registerToolRoutes(app: FastifyInstance) {
  app.post('/classes/:classId/lottery/draw', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        count: z.number().int().min(1).max(50).optional().default(1),
        mode: z.enum(['plain', 'noRepeat', 'weighted']).optional().default('plain'),
        excludeStudentIds: z.array(z.string().uuid()).optional(),
        tagIds: z.array(z.string().uuid()).optional(),
        record: z.boolean().optional().default(true),
      })
      .parse(req.body ?? {});

    await requireClass(classId, userId);

    const excluded = new Set(body.excludeStudentIds ?? []);
    const students = await prisma.student.findMany({
      where: {
        classId,
        deletedAt: null,
        status: 'active',
        ...(body.tagIds?.length ? { studentTags: { some: { tagId: { in: body.tagIds } } } } : {}),
      },
      include: { _count: { select: { lotteryRecords: true } } },
    });

    const candidates = students.filter((s) => !excluded.has(s.id));
    if (candidates.length === 0) throw ApiError.businessRule('没有符合条件的学生可抽取');

    // Reset markers reuse a student id to mark a round boundary, so they must
    // not inflate that student's weighted-draw count.
    const realCounts = await prisma.lotteryRecord.groupBy({
      by: ['studentId'],
      where: { classId, mode: { not: 'reset' } },
      _count: { studentId: true },
    });
    const drawCountById = new Map(realCounts.map((r) => [r.studentId, r._count.studentId]));

    let drawnThisRound: string[] = [];
    if (body.mode === 'noRepeat') {
      const since = await roundStartedAt(classId);
      const records = await prisma.lotteryRecord.findMany({
        where: {
          classId,
          mode: 'noRepeat',
          ...(since ? { createdAt: { gt: since } } : {}),
        },
        select: { studentId: true },
      });
      drawnThisRound = records.map((r) => r.studentId);
    }

    let result;
    try {
      result = draw(
        candidates.map((s) => ({ id: s.id, drawCount: drawCountById.get(s.id) ?? 0 })),
        { count: body.count, mode: body.mode, drawnThisRound },
      );
    } catch (e) {
      throw ApiError.businessRule((e as Error).message);
    }

    if (body.record) {
      // A reset caused by exhaustion starts a fresh round before logging picks,
      // so the next draw does not see the previous round's history.
      if (result.roundReset && body.mode === 'noRepeat') {
        await prisma.lotteryRecord.create({
          data: { classId, studentId: candidates[0].id, mode: 'reset' },
        });
      }
      await prisma.lotteryRecord.createMany({
        data: result.picked.map((studentId) => ({ classId, studentId, mode: body.mode })),
      });
    }

    const byId = new Map(students.map((s) => [s.id, s]));

    return {
      data: {
        students: result.picked.map((id) => {
          const s = byId.get(id)!;
          return { id: s.id, name: s.name, studentNo: s.studentNo, avatarUrl: s.avatarUrl };
        }),
        roundRemaining: result.roundRemaining,
        roundReset: result.roundReset,
      },
    };
  });

  app.post('/classes/:classId/lottery/reset', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    await requireClass(classId, userId);

    const anyStudent = await prisma.student.findFirst({
      where: { classId, deletedAt: null },
      select: { id: true },
    });
    if (!anyStudent) throw ApiError.businessRule('该班级没有学生');

    await prisma.lotteryRecord.create({
      data: { classId, studentId: anyStudent.id, mode: 'reset' },
    });

    return reply.status(204).send();
  });

  app.get('/classes/:classId/lottery/records', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(req.query);

    await requireClass(classId, userId);

    const where = {
      classId,
      mode: { not: 'reset' },
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const { skip, take } = paginate(q.page, q.pageSize);
    const [rows, total, grouped] = await Promise.all([
      prisma.lotteryRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { student: { select: { name: true, studentNo: true } } },
      }),
      prisma.lotteryRecord.count({ where }),
      prisma.lotteryRecord.groupBy({
        by: ['studentId'],
        where,
        _count: { studentId: true },
      }),
    ]);

    const names = await prisma.student.findMany({
      where: { id: { in: grouped.map((g) => g.studentId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((n) => [n.id, n.name]));

    return {
      data: rows.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.student.name,
        studentNo: r.student.studentNo,
        mode: r.mode,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: pageMeta(q.page, q.pageSize, total),
      summary: grouped
        .map((g) => ({
          studentId: g.studentId,
          studentName: nameById.get(g.studentId) ?? null,
          count: g._count.studentId,
        }))
        .sort((a, b) => b.count - a.count),
    };
  });

  app.post('/classes/:classId/grouping/generate', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        mode: z.enum(['byGroupCount', 'byGroupSize']),
        groupCount: z.number().int().min(1).max(50).nullable().optional(),
        groupSize: z.number().int().min(1).max(50).nullable().optional(),
        includeStudentIds: z.array(z.string().uuid()).nullable().optional(),
        excludeStudentIds: z.array(z.string().uuid()).nullable().optional(),
        balanceGender: z.boolean().optional().default(false),
        balanceByExamId: z.string().uuid().nullable().optional(),
        separatePairs: z.array(z.tuple([z.string().uuid(), z.string().uuid()])).optional(),
        persist: z.boolean().optional().default(false),
        name: z.string().max(64).optional(),
      })
      .parse(req.body);

    await requireClass(classId, userId);

    if (body.mode === 'byGroupCount' && !body.groupCount) {
      throw ApiError.validation('byGroupCount 模式必须提供 groupCount');
    }
    if (body.mode === 'byGroupSize' && !body.groupSize) {
      throw ApiError.validation('byGroupSize 模式必须提供 groupSize');
    }

    const include = body.includeStudentIds ? new Set(body.includeStudentIds) : null;
    const exclude = new Set(body.excludeStudentIds ?? []);

    const students = await prisma.student.findMany({
      where: { classId, deletedAt: null, status: 'active' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    let pool = students.filter((s) => !exclude.has(s.id));
    if (include) pool = pool.filter((s) => include.has(s.id));

    if (pool.length === 0) throw ApiError.businessRule('没有可分组的学生');

    // Score balance reads the referenced exam; absent students carry no score
    // and simply distribute without affecting group averages.
    let scoreById = new Map<string, number | null>();
    if (body.balanceByExamId) {
      const exam = await prisma.exam.findFirst({
        where: { id: body.balanceByExamId, deletedAt: null, class: { userId, deletedAt: null } },
      });
      if (!exam) throw ApiError.forbidden('无权访问该考试');

      const scores = await prisma.score.findMany({
        where: { examId: body.balanceByExamId, isAbsent: false, score: { not: null } },
      });
      scoreById = new Map(scores.map((s) => [s.studentId, Number(s.score)]));
    }

    let groups;
    try {
      groups = generateGroups(
        pool.map((s) => ({
          id: s.id,
          name: s.name,
          gender: s.gender,
          score: scoreById.get(s.id) ?? null,
        })),
        {
          mode: body.mode,
          groupCount: body.groupCount ?? undefined,
          groupSize: body.groupSize ?? undefined,
          balanceGender: body.balanceGender,
          balanceByScore: Boolean(body.balanceByExamId),
          separatePairs: body.separatePairs,
        },
      );
    } catch (e) {
      throw ApiError.businessRule((e as Error).message);
    }

    let planId: string | null = null;
    if (body.persist) {
      const plan = await prisma.groupingPlan.create({
        data: {
          classId,
          name: body.name?.trim() || `分组方案 ${new Date().toISOString().slice(0, 10)}`,
          options: {
            mode: body.mode,
            groupCount: body.groupCount ?? null,
            groupSize: body.groupSize ?? null,
            balanceGender: body.balanceGender,
            balanceByExamId: body.balanceByExamId ?? null,
            separatePairs: body.separatePairs ?? [],
          },
          groups: {
            create: groups.map((g) => ({
              name: g.name,
              groupIndex: g.groupIndex,
              members: { create: g.members.map((m) => ({ studentId: m.id })) },
            })),
          },
        },
      });
      planId = plan.id;
    }

    return { data: { planId, groups } };
  });

  app.get('/classes/:classId/grouping/plans', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    await requireClass(classId, userId);

    const plans = await prisma.groupingPlan.findMany({
      where: { classId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { groups: true } } },
    });

    return {
      data: plans.map((p) => ({
        id: p.id,
        classId: p.classId,
        name: p.name,
        options: p.options,
        groupCount: p._count.groups,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  });

  app.get('/grouping-plans/:planId', async (req) => {
    const userId = requireUser(req);
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.params);
    await requireGroupingPlan(planId, userId);

    const plan = await prisma.groupingPlan.findFirstOrThrow({
      where: { id: planId },
      include: {
        groups: {
          orderBy: { groupIndex: 'asc' },
          include: { members: { include: { student: true } } },
        },
      },
    });

    return {
      data: {
        id: plan.id,
        classId: plan.classId,
        name: plan.name,
        options: plan.options,
        createdAt: plan.createdAt.toISOString(),
        groups: plan.groups.map((g) => ({
          groupIndex: g.groupIndex,
          name: g.name,
          members: g.members.map((m) => ({
            id: m.student.id,
            name: m.student.name,
            studentNo: m.student.studentNo,
            gender: m.student.gender,
          })),
        })),
      },
    };
  });

  app.delete('/grouping-plans/:planId', async (req, reply) => {
    const userId = requireUser(req);
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.params);
    await requireGroupingPlan(planId, userId);

    await prisma.groupingPlan.update({
      where: { id: planId },
      data: { deletedAt: new Date() },
    });

    return reply.status(204).send();
  });
}
