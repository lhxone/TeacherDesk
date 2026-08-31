import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireClass, requireStudent } from '../lib/ownership.js';
import { paginate, pageMeta } from '../lib/pagination.js';
import { mean, stddev } from '../lib/stats.js';
import {
  buildTemplateWorkbook,
  xlsxAttachment,
  readTemplateRows,
  requireUploadedFile,
} from '../lib/excel.js';

const GENDER_LABEL_TO_CODE: Record<string, string> = { 男: 'male', 女: 'female', 其他: 'other' };

const genderEnum = z.enum(['male', 'female', 'other']);

const createSchema = z.object({
  name: z.string().min(1, '姓名不能为空').max(64),
  studentNo: z.string().max(32).nullable().optional(),
  gender: genderEnum.nullable().optional(),
  avatarUrl: z.string().max(512).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  qq: z.string().max(20).nullable().optional(),
  note: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

type StudentRow = {
  id: string;
  classId: string;
  name: string;
  studentNo: string | null;
  gender: string | null;
  avatarUrl: string | null;
  phone: string | null;
  qq: string | null;
  note: string | null;
  sortOrder: number;
  status: string;
  studentTags?: { tag: { id: string; name: string; color: string } }[];
};

function serializeStudent(s: StudentRow) {
  return {
    id: s.id,
    classId: s.classId,
    name: s.name,
    studentNo: s.studentNo,
    gender: s.gender,
    avatarUrl: s.avatarUrl,
    phone: s.phone,
    qq: s.qq,
    note: s.note,
    sortOrder: s.sortOrder,
    status: s.status,
    tags: (s.studentTags ?? []).map((st) => st.tag),
  };
}

/** Student numbers must be unique within a class among non-deleted rows. */
async function assertStudentNoFree(classId: string, studentNo: string, excludeId?: string) {
  const clash = await prisma.student.findFirst({
    where: {
      classId,
      studentNo,
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (clash) {
    throw ApiError.conflict(`学号 ${studentNo} 在本班已存在`, [
      { field: 'studentNo', message: `学号 ${studentNo} 在本班已存在` },
    ]);
  }
}

export async function registerStudentRoutes(app: FastifyInstance) {
  app.get('/classes/:classId/students', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    await requireClass(classId, userId);

    const q = z
      .object({
        q: z.string().optional(),
        tagIds: z.string().optional(),
        status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
        sort: z.enum(['sortOrder', 'name', 'studentNo']).optional().default('sortOrder'),
      })
      .parse(req.query);

    const tagIds = q.tagIds?.split(',').filter(Boolean) ?? [];

    const where = {
      classId,
      deletedAt: null,
      ...(q.status === 'all' ? {} : { status: q.status }),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' as const } },
              { studentNo: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(tagIds.length ? { studentTags: { some: { tagId: { in: tagIds } } } } : {}),
    };

    const orderBy =
      q.sort === 'name'
        ? [{ name: 'asc' as const }]
        : q.sort === 'studentNo'
          ? [{ studentNo: 'asc' as const }]
          : [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

    const { skip, take } = paginate(q.page, q.pageSize);
    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { studentTags: { include: { tag: true } } },
      }),
      prisma.student.count({ where }),
    ]);

    return {
      data: rows.map(serializeStudent),
      meta: pageMeta(q.page, q.pageSize, total),
    };
  });

  app.post('/classes/:classId/students', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = createSchema.parse(req.body);
    await requireClass(classId, userId);

    if (body.studentNo) await assertStudentNoFree(classId, body.studentNo);

    if (body.tagIds?.length) {
      const owned = await prisma.tag.count({ where: { id: { in: body.tagIds }, userId } });
      if (owned !== body.tagIds.length) throw ApiError.forbidden('包含无权使用的标签');
    }

    const student = await prisma.student.create({
      data: {
        classId,
        name: body.name.trim(),
        studentNo: body.studentNo ?? null,
        gender: body.gender ?? null,
        avatarUrl: body.avatarUrl ?? null,
        phone: body.phone ?? null,
        qq: body.qq ?? null,
        note: body.note ?? null,
        sortOrder: body.sortOrder ?? 0,
        studentTags: body.tagIds?.length
          ? { create: body.tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: { studentTags: { include: { tag: true } } },
    });

    return reply.status(201).send({ data: serializeStudent(student) });
  });

  const importStudentSchema = z.object({
    name: z.string().min(1).max(64),
    studentNo: z.string().max(32).nullable().optional(),
    gender: genderEnum.nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
  });
  type ImportStudent = z.infer<typeof importStudentSchema>;

  /**
   * Shared by the JSON bulk-import endpoint and the Excel-file import: validate
   * name/studentNo conflicts, and on a non-dry run persist the valid rows.
   * dryRun previews conflicts without writing (AC-4); on a real run, invalid
   * rows are skipped and the valid ones still land.
   */
  async function runBulkImport(classId: string, students: ImportStudent[], dryRun: boolean) {
    const existing = await prisma.student.findMany({
      where: { classId, deletedAt: null, studentNo: { not: null } },
      select: { studentNo: true },
    });
    const taken = new Set(existing.map((e) => e.studentNo as string));
    const seenInBatch = new Set<string>();

    const rows = students.map((s, index) => {
      const errors: string[] = [];
      const studentNo = s.studentNo?.trim() || null;

      if (!s.name.trim()) errors.push('姓名不能为空');
      if (studentNo) {
        if (taken.has(studentNo)) errors.push(`学号 ${studentNo} 在本班已存在`);
        else if (seenInBatch.has(studentNo)) errors.push(`学号 ${studentNo} 在本次导入中重复`);
        else seenInBatch.add(studentNo);
      }

      return errors.length
        ? { index, status: 'error' as const, errors, student: { ...s, studentNo } }
        : { index, status: 'ok' as const, student: { ...s, studentNo } };
    });

    const validRows = rows.filter((r) => r.status === 'ok');

    let created = 0;
    if (!dryRun && validRows.length) {
      const maxOrder = await prisma.student.aggregate({
        where: { classId, deletedAt: null },
        _max: { sortOrder: true },
      });
      let order = (maxOrder._max.sortOrder ?? 0) + 1;

      const result = await prisma.student.createMany({
        data: validRows.map((r) => ({
          classId,
          name: r.student.name.trim(),
          studentNo: r.student.studentNo,
          gender: r.student.gender ?? null,
          phone: r.student.phone ?? null,
          sortOrder: order++,
        })),
      });
      created = result.count;
    }

    return {
      total: rows.length,
      valid: validRows.length,
      invalid: rows.length - validRows.length,
      created,
      dryRun,
      rows,
    };
  }

  app.post('/classes/:classId/students/bulk-import', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        dryRun: z.boolean().optional().default(true),
        students: z
          .array(importStudentSchema)
          .min(1, '至少需要一条学生数据')
          .max(500, '单次最多导入 500 条'),
      })
      .parse(req.body);

    await requireClass(classId, userId);
    const result = await runBulkImport(classId, body.students, body.dryRun);
    return { data: result };
  });

  // Excel template for the roster bulk-import: blank rows the teacher fills
  // in offline, then re-uploads via import-file below.
  app.get('/classes/:classId/students/import-template', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const cls = await requireClass(classId, userId);

    const columns = [
      { header: '学号', key: 'no', width: 12 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '性别（男/女/其他，选填）', key: 'gender', width: 22 },
      { header: '联系电话（选填）', key: 'phone', width: 18 },
    ];
    const buffer = await buildTemplateWorkbook(
      '学生导入模板',
      `${cls.name} · 学生导入模板`,
      columns,
      [],
    );

    const filename = `${cls.name}-学生导入模板.xlsx`;
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', xlsxAttachment(filename))
      .send(buffer);
  });

  // Parses an uploaded filled-in template and runs it through the same
  // validation/preview/write path as the JSON bulk-import endpoint.
  app.post('/classes/:classId/students/import-file', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const dryRun = z.object({ dryRun: z.string().optional() }).parse(req.query).dryRun !== 'false';

    await requireClass(classId, userId);

    const file = await requireUploadedFile(req);
    const rows = await readTemplateRows(file);
    if (!rows.length) throw ApiError.validation('模板文件为空');
    if (rows.length > 500) throw ApiError.validation('单次最多导入 500 条');

    const students: ImportStudent[] = rows.map(([no, name, genderText, phone]) => ({
      name: (name ?? '').trim(),
      studentNo: no?.trim() || null,
      gender: (GENDER_LABEL_TO_CODE[(genderText ?? '').trim()] ?? null) as ImportStudent['gender'],
      phone: phone?.trim() || null,
    }));

    const result = await runBulkImport(classId, students, dryRun);
    return { data: result };
  });

  app.patch('/classes/:classId/students/batch', async (req) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        studentIds: z.array(z.string().uuid()).min(1),
        action: z.enum(['addTags', 'removeTags', 'setStatus', 'delete']),
        payload: z.record(z.unknown()).optional(),
      })
      .parse(req.body);

    await requireClass(classId, userId);

    const owned = await prisma.student.count({
      where: { id: { in: body.studentIds }, classId, deletedAt: null },
    });
    if (owned !== body.studentIds.length) throw ApiError.forbidden('包含不属于该班级的学生');

    let affected = 0;

    switch (body.action) {
      case 'addTags': {
        const tagIds = z.array(z.string().uuid()).parse(body.payload?.tagIds ?? []);
        const ownedTags = await prisma.tag.count({ where: { id: { in: tagIds }, userId } });
        if (ownedTags !== tagIds.length) throw ApiError.forbidden('包含无权使用的标签');

        const result = await prisma.studentTag.createMany({
          data: body.studentIds.flatMap((studentId) => tagIds.map((tagId) => ({ studentId, tagId }))),
          skipDuplicates: true,
        });
        affected = result.count;
        break;
      }
      case 'removeTags': {
        const tagIds = z.array(z.string().uuid()).parse(body.payload?.tagIds ?? []);
        const result = await prisma.studentTag.deleteMany({
          where: { studentId: { in: body.studentIds }, tagId: { in: tagIds } },
        });
        affected = result.count;
        break;
      }
      case 'setStatus': {
        const status = z.enum(['active', 'inactive']).parse(body.payload?.status);
        const result = await prisma.student.updateMany({
          where: { id: { in: body.studentIds } },
          data: { status },
        });
        affected = result.count;
        break;
      }
      case 'delete': {
        const result = await prisma.student.updateMany({
          where: { id: { in: body.studentIds } },
          data: { deletedAt: new Date() },
        });
        affected = result.count;
        break;
      }
    }

    return { data: { affected } };
  });

  app.get('/students/:studentId', async (req) => {
    const userId = requireUser(req);
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.params);
    const student = await requireStudent(studentId, userId);

    const [full, scores, lotteryCount, seat] = await Promise.all([
      prisma.student.findFirstOrThrow({
        where: { id: studentId },
        include: { studentTags: { include: { tag: true } } },
      }),
      prisma.score.findMany({
        where: { studentId, isAbsent: false, score: { not: null }, exam: { deletedAt: null } },
        include: { exam: true },
        orderBy: { exam: { examDate: 'asc' } },
      }),
      prisma.lotteryRecord.count({ where: { studentId } }),
      prisma.seatAssignment.findFirst({
        where: { studentId, seatingChart: { isActive: true, deletedAt: null } },
      }),
    ]);

    const values = scores.map((s) => Number(s.score));

    return {
      data: {
        ...serializeStudent(full),
        className: student.class.name,
        stats: {
          examCount: values.length,
          avgScore: mean(values),
          stddev: stddev(values),
          lotteryCount,
        },
        currentSeat: seat
          ? {
              seatingChartId: seat.seatingChartId,
              rowIndex: seat.rowIndex,
              colIndex: seat.colIndex,
            }
          : null,
      },
    };
  });

  app.patch('/students/:studentId', async (req) => {
    const userId = requireUser(req);
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.params);
    const body = createSchema
      .partial()
      .extend({ status: z.enum(['active', 'inactive']).optional() })
      .parse(req.body);

    const student = await requireStudent(studentId, userId);

    if (body.studentNo) {
      await assertStudentNoFree(student.classId, body.studentNo, studentId);
    }

    if (body.tagIds) {
      const ownedTags = await prisma.tag.count({ where: { id: { in: body.tagIds }, userId } });
      if (ownedTags !== body.tagIds.length) throw ApiError.forbidden('包含无权使用的标签');

      await prisma.$transaction([
        prisma.studentTag.deleteMany({ where: { studentId } }),
        prisma.studentTag.createMany({
          data: body.tagIds.map((tagId) => ({ studentId, tagId })),
          skipDuplicates: true,
        }),
      ]);
    }

    const updated = await prisma.student.update({
      where: { id: studentId },
      data: {
        name: body.name?.trim(),
        studentNo: body.studentNo,
        gender: body.gender,
        avatarUrl: body.avatarUrl,
        phone: body.phone,
        qq: body.qq,
        note: body.note,
        sortOrder: body.sortOrder,
        status: body.status,
      },
      include: { studentTags: { include: { tag: true } } },
    });

    return { data: serializeStudent(updated) };
  });

  app.delete('/students/:studentId', async (req, reply) => {
    const userId = requireUser(req);
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.params);
    await requireStudent(studentId, userId);

    await prisma.student.update({
      where: { id: studentId },
      data: { deletedAt: new Date() },
    });

    return reply.status(204).send();
  });
}
