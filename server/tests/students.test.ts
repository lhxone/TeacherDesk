import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import {
  createClass,
  createStudents,
  createTestApp,
  multipartFile,
  prisma,
  registerUser,
  resetDb,
  type TestUser,
} from './helpers.js';

/** Build a minimal .xlsx buffer with a title row, header row, then data rows — matching
 * the shape buildTemplateWorkbook produces, which readTemplateRows skips the first two of. */
async function buildXlsx(headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('sheet1');
  sheet.addRow(['title']);
  sheet.addRow(headers);
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

let app: FastifyInstance;
let user: TestUser;
let classId: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  user = await registerUser(app);
  classId = await createClass(app, user);
});

describe('classes', () => {
  it('AC-3: soft-deleting a class hides its students from the API', async () => {
    await createStudents(app, user, classId, [{ name: '张三' }, { name: '李四' }]);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/classes/${classId}`,
      headers: user.auth,
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students`,
      headers: user.auth,
    });
    expect(list.statusCode).toBe(403);

    // Rows survive in the database (soft delete), only reachability is gone.
    expect(await prisma.student.count({ where: { classId } })).toBe(2);
  });

  it('excludes archived classes from the default list but includes them on request', async () => {
    const archived = await createClass(app, user, { name: '去年的班' });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/classes/${archived}`,
      headers: user.auth,
      payload: { status: 'archived' },
    });

    const active = await app.inject({ method: 'GET', url: '/api/v1/classes', headers: user.auth });
    expect(active.json().data.map((c: { id: string }) => c.id)).toEqual([classId]);

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/classes?status=all',
      headers: user.auth,
    });
    expect(all.json().data).toHaveLength(2);
  });

  it('reports the student count on the class card', async () => {
    await createStudents(app, user, classId, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/classes', headers: user.auth });
    expect(res.json().data[0].studentCount).toBe(3);
  });

  it('rejects a class without a name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/classes',
      headers: user.auth,
      payload: { name: '', academicYear: '2026-2027' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('students: CRUD', () => {
  it('creates and lists students', async () => {
    await createStudents(app, user, classId, [
      { name: '张三', studentNo: '01' },
      { name: '李四', studentNo: '02' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students`,
      headers: user.auth,
    });

    expect(res.json().data).toHaveLength(2);
    expect(res.json().meta.total).toBe(2);
  });

  it('rejects a duplicate student number in the same class', async () => {
    await createStudents(app, user, classId, [{ name: '张三', studentNo: '01' }]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students`,
      headers: user.auth,
      payload: { name: '李四', studentNo: '01' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('allows the same student number in a different class', async () => {
    const other = await createClass(app, user, { name: '高二(4)班' });
    await createStudents(app, user, classId, [{ name: '张三', studentNo: '01' }]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${other}/students`,
      headers: user.auth,
      payload: { name: '王五', studentNo: '01' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('frees a student number once the holder is soft-deleted', async () => {
    const [id] = await createStudents(app, user, classId, [{ name: '张三', studentNo: '01' }]);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/students/${id}`,
      headers: user.auth,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students`,
      headers: user.auth,
      payload: { name: '新同学', studentNo: '01' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('searches by name and by student number', async () => {
    await createStudents(app, user, classId, [
      { name: '张三', studentNo: '01' },
      { name: '李四', studentNo: '02' },
    ]);

    const byName = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students?q=张`,
      headers: user.auth,
    });
    expect(byName.json().data).toHaveLength(1);

    const byNo = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students?q=02`,
      headers: user.auth,
    });
    expect(byNo.json().data[0].name).toBe('李四');
  });

  it('paginates the roster', async () => {
    await createStudents(
      app,
      user,
      classId,
      Array.from({ length: 25 }, (_, i) => ({ name: `学生${i}` })),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students?page=2&pageSize=10`,
      headers: user.auth,
    });

    expect(res.json().data).toHaveLength(10);
    expect(res.json().meta).toMatchObject({ page: 2, pageSize: 10, total: 25, totalPages: 3 });
  });
});

describe('students: bulk import', () => {
  it('AC-4: dry run flags duplicate student numbers and writes nothing', async () => {
    await createStudents(app, user, classId, [{ name: '已存在', studentNo: '01' }]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/bulk-import`,
      headers: user.auth,
      payload: {
        dryRun: true,
        students: [
          { name: '张三', studentNo: '02' },
          { name: '李四', studentNo: '01' },
        ],
      },
    });

    const data = res.json().data;
    expect(data.valid).toBe(1);
    expect(data.invalid).toBe(1);
    expect(data.rows[1].status).toBe('error');
    expect(data.rows[1].errors[0]).toContain('已存在');

    // Nothing written during a dry run.
    expect(await prisma.student.count({ where: { classId } })).toBe(1);
  });

  it('AC-4: a real run writes the valid rows and skips the conflicting ones', async () => {
    await createStudents(app, user, classId, [{ name: '已存在', studentNo: '01' }]);

    const rows = Array.from({ length: 60 }, (_, i) => ({
      name: `学生${i}`,
      studentNo: String(i + 1).padStart(2, '0'),
    }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/bulk-import`,
      headers: user.auth,
      payload: { dryRun: false, students: rows },
    });

    const data = res.json().data;
    // '01' collides with the existing student; the other 59 land.
    expect(data.invalid).toBe(1);
    expect(data.created).toBe(59);
    expect(await prisma.student.count({ where: { classId, deletedAt: null } })).toBe(60);
  });

  it('detects duplicates inside the same batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/bulk-import`,
      headers: user.auth,
      payload: {
        dryRun: true,
        students: [
          { name: '张三', studentNo: '01' },
          { name: '李四', studentNo: '01' },
        ],
      },
    });

    const data = res.json().data;
    expect(data.invalid).toBe(1);
    expect(data.rows[1].errors[0]).toContain('本次导入中重复');
  });

  it('imports students without student numbers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/bulk-import`,
      headers: user.auth,
      payload: { dryRun: false, students: [{ name: '张三' }, { name: '李四' }] },
    });

    expect(res.json().data.created).toBe(2);
  });

  it('rejects an empty import', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/bulk-import`,
      headers: user.auth,
      payload: { dryRun: true, students: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('students: Excel template import', () => {
  it('downloads a blank .xlsx template with the expected headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students/import-template`,
      headers: user.auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.rawPayload);
    const values = workbook.worksheets[0]
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string');
    expect(values).toContain('学号');
    expect(values).toContain('姓名');
  });

  it('previews an uploaded .xlsx without writing on a dry run', async () => {
    await createStudents(app, user, classId, [{ name: '已存在', studentNo: '01' }]);
    const buffer = await buildXlsx(
      ['学号', '姓名', '性别', '电话'],
      [
        ['02', '张三', '男', ''],
        ['01', '李四', '女', ''],
      ],
    );
    const { headers, payload } = multipartFile(buffer, 'roster.xlsx');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/import-file`,
      headers: { ...user.auth, ...headers },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.dryRun).toBe(true);
    expect(data.valid).toBe(1);
    expect(data.invalid).toBe(1);
    expect(data.rows[1].errors[0]).toContain('已存在');
    expect(await prisma.student.count({ where: { classId } })).toBe(1);
  });

  it('writes valid rows when dryRun=false', async () => {
    const buffer = await buildXlsx(
      ['学号', '姓名', '性别', '电话'],
      [['01', '张三', '', ''], ['02', '李四', '', '']],
    );
    const { headers, payload } = multipartFile(buffer, 'roster.xlsx');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/import-file?dryRun=false`,
      headers: { ...user.auth, ...headers },
      payload,
    });

    expect(res.json().data.created).toBe(2);
    expect(await prisma.student.count({ where: { classId, deletedAt: null } })).toBe(2);
  });

  it('rejects a non-.xlsx upload', async () => {
    const { headers, payload } = multipartFile(Buffer.from('name\n张三'), 'roster.csv', 'text/csv');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students/import-file`,
      headers: { ...user.auth, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('students: batch operations and tags', () => {
  it('adds a tag to many students at once', async () => {
    const ids = await createStudents(app, user, classId, [{ name: 'A' }, { name: 'B' }]);
    const tag = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: user.auth,
      payload: { name: '需关注' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/classes/${classId}/students/batch`,
      headers: user.auth,
      payload: { studentIds: ids, action: 'addTags', payload: { tagIds: [tag.json().data.id] } },
    });

    expect(res.json().data.affected).toBe(2);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students?tagIds=${tag.json().data.id}`,
      headers: user.auth,
    });
    expect(list.json().data).toHaveLength(2);
  });

  it('batch-deletes students softly', async () => {
    const ids = await createStudents(app, user, classId, [{ name: 'A' }, { name: 'B' }]);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/classes/${classId}/students/batch`,
      headers: user.auth,
      payload: { studentIds: ids, action: 'delete' },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students`,
      headers: user.auth,
    });
    expect(list.json().data).toHaveLength(0);
    expect(await prisma.student.count({ where: { classId } })).toBe(2);
  });

  it('deleting a tag detaches it from students but keeps them', async () => {
    const ids = await createStudents(app, user, classId, [{ name: 'A' }]);
    const tag = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: user.auth,
      payload: { name: '课代表' },
    });
    const tagId = tag.json().data.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/classes/${classId}/students/batch`,
      headers: user.auth,
      payload: { studentIds: ids, action: 'addTags', payload: { tagIds: [tagId] } },
    });

    await app.inject({ method: 'DELETE', url: `/api/v1/tags/${tagId}`, headers: user.auth });

    const student = await app.inject({
      method: 'GET',
      url: `/api/v1/students/${ids[0]}`,
      headers: user.auth,
    });
    expect(student.statusCode).toBe(200);
    expect(student.json().data.tags).toHaveLength(0);
  });

  it('rejects a duplicate tag name for the same user', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: user.auth,
      payload: { name: '课代表' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: user.auth,
      payload: { name: '课代表' },
    });
    expect(res.statusCode).toBe(409);
  });
});
