import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { assertStudentsInClass, requireClass, requireSeatingChart } from '../lib/ownership.js';
import { randomizeSeating } from '../lib/seating.js';

const layoutSchema = z
  .object({
    podium: z.enum(['top', 'bottom']).optional(),
    disabledCells: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
    aisles: z.object({ afterCols: z.array(z.number().int()) }).optional(),
  })
  .passthrough();

const createSchema = z.object({
  name: z.string().min(1, '方案名称不能为空').max(64),
  rowCount: z.number().int().min(1).max(20),
  colCount: z.number().int().min(1).max(20),
  layout: layoutSchema.optional(),
  isActive: z.boolean().optional().default(false),
});

type Layout = z.infer<typeof layoutSchema>;

function disabledOf(layout: unknown): [number, number][] {
  return ((layout as Layout)?.disabledCells ?? []) as [number, number][];
}

export async function registerSeatingRoutes(app: FastifyInstance) {
  app.get('/classes/:classId/seating-charts', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    await requireClass(classId, userId);

    const charts = await prisma.seatingChart.findMany({
      where: { classId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      include: { _count: { select: { assignments: true } } },
    });

    return {
      data: charts.map((c) => ({
        id: c.id,
        classId: c.classId,
        name: c.name,
        rowCount: c.rowCount,
        colCount: c.colCount,
        layout: c.layout,
        isActive: c.isActive,
        assignedCount: c._count.assignments,
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  });

  app.post('/classes/:classId/seating-charts', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = createSchema.parse(req.body);
    await requireClass(classId, userId);

    // Deactivate first: uq_chart_active rejects a second active row, so the
    // clear must land before the insert, and both must be atomic.
    const chart = await prisma.$transaction(async (tx) => {
      if (body.isActive) {
        await tx.seatingChart.updateMany({
          where: { classId, deletedAt: null, isActive: true },
          data: { isActive: false },
        });
      }
      return tx.seatingChart.create({
        data: {
          classId,
          name: body.name.trim(),
          rowCount: body.rowCount,
          colCount: body.colCount,
          layout: (body.layout ?? {}) as object,
          isActive: body.isActive,
        },
      });
    });

    return reply.status(201).send({
      data: { ...chart, assignments: [], updatedAt: chart.updatedAt.toISOString() },
    });
  });

  app.get('/seating-charts/:chartId', async (req) => {
    const userId = requireUser(req);
    const { chartId } = z.object({ chartId: z.string().uuid() }).parse(req.params);
    const chart = await requireSeatingChart(chartId, userId);

    const [assignments, allStudents] = await Promise.all([
      prisma.seatAssignment.findMany({
        where: { seatingChartId: chartId },
        include: { student: true },
        orderBy: [{ rowIndex: 'asc' }, { colIndex: 'asc' }],
      }),
      prisma.student.findMany({
        where: { classId: chart.classId, deletedAt: null, status: 'active' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const seated = new Set(assignments.map((a) => a.studentId));

    return {
      data: {
        id: chart.id,
        classId: chart.classId,
        name: chart.name,
        rowCount: chart.rowCount,
        colCount: chart.colCount,
        layout: chart.layout,
        isActive: chart.isActive,
        assignments: assignments.map((a) => ({
          studentId: a.studentId,
          studentName: a.student.name,
          studentNo: a.student.studentNo,
          gender: a.student.gender,
          rowIndex: a.rowIndex,
          colIndex: a.colIndex,
          isPinned: a.isPinned,
        })),
        unassignedStudents: allStudents
          .filter((s) => !seated.has(s.id))
          .map((s) => ({ id: s.id, name: s.name, studentNo: s.studentNo, gender: s.gender })),
      },
    };
  });

  app.patch('/seating-charts/:chartId', async (req) => {
    const userId = requireUser(req);
    const { chartId } = z.object({ chartId: z.string().uuid() }).parse(req.params);
    const body = createSchema.partial().parse(req.body);
    const chart = await requireSeatingChart(chartId, userId);

    const rowCount = body.rowCount ?? chart.rowCount;
    const colCount = body.colCount ?? chart.colCount;

    // Shrinking the grid must not orphan seated students (API.md §7 PATCH).
    if (rowCount < chart.rowCount || colCount < chart.colCount) {
      const outOfBounds = await prisma.seatAssignment.findMany({
        where: {
          seatingChartId: chartId,
          OR: [{ rowIndex: { gte: rowCount } }, { colIndex: { gte: colCount } }],
        },
        include: { student: { select: { name: true } } },
      });

      if (outOfBounds.length) {
        throw ApiError.businessRule('缩小座位表会导致已排座学生越界', outOfBounds.map((a) => ({
          field: a.studentId,
          message: `${a.student.name} 当前在第 ${a.rowIndex + 1} 行第 ${a.colIndex + 1} 列，超出新尺寸`,
        })));
      }
    }

    // Same ordering constraint as create: clear the previous active chart
    // before this one claims the flag.
    const updated = await prisma.$transaction(async (tx) => {
      if (body.isActive) {
        await tx.seatingChart.updateMany({
          where: { classId: chart.classId, deletedAt: null, isActive: true, id: { not: chartId } },
          data: { isActive: false },
        });
      }
      return tx.seatingChart.update({
        where: { id: chartId },
        data: {
          name: body.name?.trim(),
          rowCount: body.rowCount,
          colCount: body.colCount,
          layout: body.layout as object | undefined,
          isActive: body.isActive,
        },
      });
    });

    return { data: { ...updated, updatedAt: updated.updatedAt.toISOString() } };
  });

  app.put('/seating-charts/:chartId/assignments', async (req) => {
    const userId = requireUser(req);
    const { chartId } = z.object({ chartId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        assignments: z.array(
          z.object({
            studentId: z.string().uuid(),
            rowIndex: z.number().int().min(0),
            colIndex: z.number().int().min(0),
            isPinned: z.boolean().optional().default(false),
          }),
        ),
      })
      .parse(req.body);

    const chart = await requireSeatingChart(chartId, userId);
    await assertStudentsInClass(body.assignments.map((a) => a.studentId), chart.classId);

    const disabled = new Set(disabledOf(chart.layout).map(([r, c]) => `${r}:${c}`));
    const seenCells = new Set<string>();
    const seenStudents = new Set<string>();

    for (const a of body.assignments) {
      const key = `${a.rowIndex}:${a.colIndex}`;

      if (a.rowIndex >= chart.rowCount || a.colIndex >= chart.colCount) {
        throw ApiError.businessRule(
          `座位 (${a.rowIndex + 1}, ${a.colIndex + 1}) 超出座位表范围`,
        );
      }
      if (disabled.has(key)) {
        throw ApiError.businessRule(`座位 (${a.rowIndex + 1}, ${a.colIndex + 1}) 是禁用格`);
      }
      if (seenCells.has(key)) {
        throw ApiError.businessRule(`座位 (${a.rowIndex + 1}, ${a.colIndex + 1}) 被重复分配`);
      }
      if (seenStudents.has(a.studentId)) {
        throw ApiError.businessRule('同一学生被分配到多个座位');
      }
      seenCells.add(key);
      seenStudents.add(a.studentId);
    }

    // Full replace: simplest correct semantics for a drag-and-drop editor
    // that always sends the whole board.
    await prisma.$transaction([
      prisma.seatAssignment.deleteMany({ where: { seatingChartId: chartId } }),
      prisma.seatAssignment.createMany({
        data: body.assignments.map((a) => ({
          seatingChartId: chartId,
          studentId: a.studentId,
          rowIndex: a.rowIndex,
          colIndex: a.colIndex,
          isPinned: a.isPinned,
        })),
      }),
    ]);

    return { data: { saved: body.assignments.length } };
  });

  app.post('/seating-charts/:chartId/randomize', async (req) => {
    const userId = requireUser(req);
    const { chartId } = z.object({ chartId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        keepPinned: z.boolean().optional().default(true),
        frontRowTagIds: z.array(z.string().uuid()).optional(),
        avoidSameGenderAdjacent: z.boolean().optional().default(false),
        persist: z.boolean().optional().default(false),
      })
      .parse(req.body ?? {});

    const chart = await requireSeatingChart(chartId, userId);

    const [students, existing] = await Promise.all([
      prisma.student.findMany({
        where: { classId: chart.classId, deletedAt: null, status: 'active' },
        include: { studentTags: true },
      }),
      prisma.seatAssignment.findMany({ where: { seatingChartId: chartId } }),
    ]);

    if (students.length === 0) throw ApiError.businessRule('该班级没有可排座的学生');

    let result;
    try {
      result = randomizeSeating(
        students.map((s) => ({
          id: s.id,
          gender: s.gender,
          tagIds: s.studentTags.map((t) => t.tagId),
        })),
        existing,
        {
          rowCount: chart.rowCount,
          colCount: chart.colCount,
          disabledCells: disabledOf(chart.layout),
          keepPinned: body.keepPinned,
          frontRowTagIds: body.frontRowTagIds,
          avoidSameGenderAdjacent: body.avoidSameGenderAdjacent,
        },
      );
    } catch (e) {
      // AC-9: seats < students is a business rule failure, not a 500.
      throw ApiError.businessRule((e as Error).message);
    }

    if (body.persist) {
      await prisma.$transaction([
        prisma.seatAssignment.deleteMany({ where: { seatingChartId: chartId } }),
        prisma.seatAssignment.createMany({
          data: result.assignments.map((a) => ({ ...a, seatingChartId: chartId })),
        }),
      ]);
    }

    const byId = new Map(students.map((s) => [s.id, s]));

    return {
      data: {
        persisted: body.persist,
        assignments: result.assignments.map((a) => ({
          ...a,
          studentName: byId.get(a.studentId)?.name ?? null,
          studentNo: byId.get(a.studentId)?.studentNo ?? null,
          gender: byId.get(a.studentId)?.gender ?? null,
        })),
      },
    };
  });

  app.delete('/seating-charts/:chartId', async (req, reply) => {
    const userId = requireUser(req);
    const { chartId } = z.object({ chartId: z.string().uuid() }).parse(req.params);
    await requireSeatingChart(chartId, userId);

    await prisma.seatingChart.update({
      where: { id: chartId },
      data: { deletedAt: new Date(), isActive: false },
    });

    return reply.status(204).send();
  });
}
