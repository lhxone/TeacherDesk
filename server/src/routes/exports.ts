import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, num } from '../db.js';
import { requireUser } from '../app.js';
import { requireClass } from '../lib/ownership.js';
import { formatDate } from '../lib/schedule.js';

/** RFC 4180 quoting; a UTF-8 BOM is prepended so Excel reads Chinese correctly. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** RFC 5987 filename* so non-ASCII names survive the Content-Disposition header. */
function attachment(name: string): string {
  return `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function registerExportRoutes(app: FastifyInstance) {
  app.get('/exports/class/:classId/scores', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const q = z.object({ examIds: z.string().optional() }).parse(req.query);

    const cls = await requireClass(classId, userId);
    const examIds = q.examIds?.split(',').filter(Boolean);

    const [students, exams] = await Promise.all([
      prisma.student.findMany({
        where: { classId, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.exam.findMany({
        where: { classId, deletedAt: null, ...(examIds?.length ? { id: { in: examIds } } : {}) },
        orderBy: { examDate: 'asc' },
        include: { scores: true },
      }),
    ]);

    const header = ['学号', '姓名', ...exams.map((e) => `${e.name}(${formatDate(e.examDate)})`)];
    const scoreLookup = new Map(
      exams.flatMap((e) => e.scores.map((s) => [`${e.id}:${s.studentId}`, s])),
    );

    const rows: unknown[][] = [header];
    for (const st of students) {
      rows.push([
        st.studentNo,
        st.name,
        ...exams.map((e) => {
          const s = scoreLookup.get(`${e.id}:${st.id}`);
          if (!s) return '';
          return s.isAbsent ? '缺考' : (num(s.score) ?? '');
        }),
      ]);
    }

    const filename = `${cls.name}-成绩单-${formatDate(new Date())}.csv`;
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', attachment(filename))
      .send(toCsv(rows));
  });

  app.get('/exports/class/:classId/students', async (req, reply) => {
    const userId = requireUser(req);
    const { classId } = z.object({ classId: z.string().uuid() }).parse(req.params);
    const cls = await requireClass(classId, userId);

    const students = await prisma.student.findMany({
      where: { classId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { studentTags: { include: { tag: true } } },
    });

    const genderLabel: Record<string, string> = { male: '男', female: '女', other: '其他' };

    const rows: unknown[][] = [
      ['学号', '姓名', '性别', '联系电话', '标签', '状态', '备注'],
      ...students.map((s) => [
        s.studentNo,
        s.name,
        s.gender ? (genderLabel[s.gender] ?? s.gender) : '',
        s.phone,
        s.studentTags.map((t) => t.tag.name).join('/'),
        s.status === 'active' ? '在读' : '非在读',
        s.note,
      ]),
    ];

    const filename = `${cls.name}-学生名册-${formatDate(new Date())}.csv`;
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', attachment(filename))
      .send(toCsv(rows));
  });
}
