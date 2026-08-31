import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
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
function attachment(name: string, fallback = 'export.csv'): string {
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
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
    const columns = [
      { header: '学号', key: 'no', width: 12 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '性别', key: 'gender', width: 8 },
      { header: '联系电话', key: 'phone', width: 16 },
      { header: '家长QQ', key: 'qq', width: 14 },
      { header: '标签', key: 'tags', width: 20 },
      { header: '状态', key: 'status', width: 10 },
      { header: '备注', key: 'note', width: 28 },
    ];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TeacherDesk';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('学生名册', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = columns;

    // Title row above the header, spanning all columns.
    sheet.spliceRows(1, 0, []);
    sheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = `${cls.name} · 学生名册`;
    titleCell.font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 28;

    const headerRow = sheet.getRow(2);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
    });

    students.forEach((s, i) => {
      const row = sheet.addRow({
        no: s.studentNo ?? '',
        name: s.name,
        gender: s.gender ? (genderLabel[s.gender] ?? s.gender) : '',
        phone: s.phone ?? '',
        qq: s.qq ?? '',
        tags: s.studentTags.map((t) => t.tag.name).join('/'),
        status: s.status === 'active' ? '在读' : '非在读',
        note: s.note ?? '',
      });
      row.eachCell((cell, colNumber) => {
        cell.alignment = { vertical: 'middle', horizontal: colNumber <= 2 ? 'center' : 'left' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
        if (i % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        }
      });
      const statusCell = row.getCell('status');
      statusCell.font = { color: { argb: s.status === 'active' ? 'FF15803D' : 'FF9CA3AF' } };
    });

    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${cls.name}-学生名册-${formatDate(new Date())}.xlsx`;
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header('Content-Disposition', attachment(filename, 'export.xlsx'))
      .send(Buffer.from(buffer));
  });
}
