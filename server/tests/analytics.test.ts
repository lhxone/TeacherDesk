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
let studentIds: string[];

async function createExam(overrides: Record<string, unknown> = {}): Promise<string> {
  const { subject = '数学', fullScore, ...sessionOverrides } = overrides;
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/classes/${classId}/exam-sessions`,
    headers: user.auth,
    payload: {
      name: '月考',
      examDate: '2026-09-25',
      ...sessionOverrides,
      subjects: [{ subject, ...(fullScore !== undefined ? { fullScore } : {}) }],
    },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().data.exams[0].id;
}

async function putScores(
  examId: string,
  scores: { studentId: string; score?: number | null; isAbsent?: boolean }[],
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/exams/${examId}/scores`,
    headers: user.auth,
    payload: { scores },
  });
}

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
  studentIds = await createStudents(app, user, classId, [
    { name: '张三', studentNo: '01' },
    { name: '李四', studentNo: '02' },
    { name: '王五', studentNo: '03' },
    { name: '赵六', studentNo: '04' },
  ]);
});

describe('scores: entry', () => {
  it('returns every active student, including those not yet entered', async () => {
    const examId = await createExam();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores`,
      headers: user.auth,
    });

    const scores = res.json().data.scores;
    expect(scores).toHaveLength(4);
    expect(scores.every((s: { score: null }) => s.score === null)).toBe(true);
  });

  it('saves scores and returns refreshed statistics', async () => {
    const examId = await createExam();
    const res = await putScores(examId, [
      { studentId: studentIds[0], score: 90 },
      { studentId: studentIds[1], score: 70 },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().data.stats.avg).toBe(80);
    expect(res.json().data.stats.attended).toBe(2);
  });

  it('upserts: omitted students keep their previous score', async () => {
    const examId = await createExam();
    await putScores(examId, [
      { studentId: studentIds[0], score: 90 },
      { studentId: studentIds[1], score: 70 },
    ]);
    await putScores(examId, [{ studentId: studentIds[0], score: 95 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores`,
      headers: user.auth,
    });
    const byId = new Map(
      res.json().data.scores.map((s: { studentId: string; score: number }) => [s.studentId, s.score]),
    );

    expect(byId.get(studentIds[0])).toBe(95);
    expect(byId.get(studentIds[1])).toBe(70);
  });

  it('rejects a score above the exam full score', async () => {
    const examId = await createExam({ fullScore: 100 });
    const res = await putScores(examId, [{ studentId: studentIds[0], score: 101 }]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a negative score', async () => {
    const examId = await createExam();
    const res = await putScores(examId, [{ studentId: studentIds[0], score: -1 }]);
    expect(res.statusCode).toBe(400);
  });

  it('accepts a score equal to the full score', async () => {
    const examId = await createExam({ fullScore: 150 });
    const res = await putScores(examId, [{ studentId: studentIds[0], score: 150 }]);
    expect(res.statusCode).toBe(200);
  });

  it('records an absence distinctly from a zero', async () => {
    const examId = await createExam();
    await putScores(examId, [
      { studentId: studentIds[0], score: 80 },
      { studentId: studentIds[1], score: null, isAbsent: true },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores`,
      headers: user.auth,
    });
    const absent = res
      .json()
      .data.scores.find((s: { studentId: string }) => s.studentId === studentIds[1]);

    expect(absent.isAbsent).toBe(true);
    expect(absent.score).toBeNull();
  });
});

describe('scores: Excel template import', () => {
  it('downloads a .xlsx template pre-filled with the roster and entered scores', async () => {
    const examId = await createExam();
    await putScores(examId, [{ studentId: studentIds[0], score: 88 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores/template`,
      headers: user.auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const workbook = new ExcelJS.Workbook();
    // exceljs's Buffer type predates @types/node's generic Buffer<T>; the
    // runtime value is a plain Buffer either way (see server/src/lib/excel.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(res.rawPayload as any);
    const values = workbook.worksheets[0]
      .getSheetValues()
      .flat()
      .filter((v) => v !== null && v !== undefined)
      .map(String);
    expect(values).toContain('张三');
    expect(values).toContain('88');
  });

  it('matches an uploaded .xlsx by student number, falling back to name, without persisting', async () => {
    const examId = await createExam({ fullScore: 100 });
    const buffer = await buildXlsx(
      ['学号', '姓名', '分数', '缺考'],
      [
        ['01', '张三', '95', ''],
        ['', '李四', '', '是'],
        ['zz', '王五', '', ''], // unknown no, falls back to name match
      ],
    );
    const { headers, payload } = multipartFile(buffer, 'scores.xlsx');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/scores/import-file`,
      headers: { ...user.auth, ...headers },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.matched).toBe(3);
    const byId = new Map(data.scores.map((s: { studentId: string }) => [s.studentId, s]));
    expect(byId.get(studentIds[0])).toMatchObject({ score: 95, isAbsent: false });
    expect(byId.get(studentIds[1])).toMatchObject({ score: null, isAbsent: true });
    // An empty score cell with no explicit 缺考 mark is still treated as
    // absent (matches the pre-Excel CSV import behavior).
    expect(byId.get(studentIds[2])).toMatchObject({ score: null, isAbsent: true });

    // Nothing written until the client PUTs the merged grid.
    expect(await prisma.score.count({ where: { examId } })).toBe(0);
  });

  it('rejects a score above the exam full score', async () => {
    const examId = await createExam({ fullScore: 100 });
    const buffer = await buildXlsx(['学号', '姓名', '分数', '缺考'], [['01', '张三', '150', '']]);
    const { headers, payload } = multipartFile(buffer, 'scores.xlsx');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/scores/import-file`,
      headers: { ...user.auth, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an upload matching no student', async () => {
    const examId = await createExam();
    const buffer = await buildXlsx(['学号', '姓名', '分数', '缺考'], [['99', '未知同学', '80', '']]);
    const { headers, payload } = multipartFile(buffer, 'scores.xlsx');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/scores/import-file`,
      headers: { ...user.auth, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('analytics: class dimension', () => {
  it('AC-12: absent students are excluded from the average and pass rate', async () => {
    const examId = await createExam();
    await putScores(examId, [
      { studentId: studentIds[0], score: 90 },
      { studentId: studentIds[1], score: 70 },
      { studentId: studentIds[2], score: null, isAbsent: true },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/exam/${examId}`,
      headers: user.auth,
    });

    const summary = res.json().data.summary;
    expect(summary.attended).toBe(2);
    expect(summary.absent).toBe(1);
    expect(summary.avg).toBe(80);
    expect(summary.passRate).toBe(1);
  });

  it('returns a distribution, grade split and ranking', async () => {
    const examId = await createExam();
    await putScores(examId, [
      { studentId: studentIds[0], score: 95 },
      { studentId: studentIds[1], score: 82 },
      { studentId: studentIds[2], score: 65 },
      { studentId: studentIds[3], score: 45 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/exam/${examId}`,
      headers: user.auth,
    });
    const data = res.json().data;

    expect(data.distribution).toHaveLength(10);
    expect(data.gradeRatio.reduce((a: number, g: { count: number }) => a + g.count, 0)).toBe(4);
    expect(data.ranking.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(data.ranking[0].studentName).toBe('张三');
  });

  it('computes rank delta against the previous exam of the same subject', async () => {
    const first = await createExam({ name: '第一次月考', examDate: '2026-09-01' });
    await putScores(first, [
      { studentId: studentIds[0], score: 60 },
      { studentId: studentIds[1], score: 90 },
    ]);

    const second = await createExam({ name: '第二次月考', examDate: '2026-10-01' });
    await putScores(second, [
      { studentId: studentIds[0], score: 95 },
      { studentId: studentIds[1], score: 70 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/exam/${second}`,
      headers: user.auth,
    });

    const rows = res.json().data.ranking;
    const zhangsan = rows.find((r: { studentId: string }) => r.studentId === studentIds[0]);

    expect(zhangsan.rank).toBe(1);
    expect(zhangsan.previousRank).toBe(2);
    expect(zhangsan.rankDelta).toBe(1); // moved up one place
  });

  it('reports a null rank delta for the first exam', async () => {
    const examId = await createExam();
    await putScores(examId, [{ studentId: studentIds[0], score: 80 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/exam/${examId}`,
      headers: user.auth,
    });
    expect(res.json().data.ranking[0].rankDelta).toBeNull();
  });

  it('returns null metrics rather than failing when nobody has a score', async () => {
    const examId = await createExam();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/exam/${examId}`,
      headers: user.auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.summary.avg).toBeNull();
    expect(res.json().data.ranking).toHaveLength(0);
  });

  it('builds a multi-exam trend series in date order', async () => {
    const a = await createExam({ name: '一', examDate: '2026-09-01' });
    const b = await createExam({ name: '二', examDate: '2026-10-01' });
    await putScores(a, [{ studentId: studentIds[0], score: 60 }]);
    await putScores(b, [{ studentId: studentIds[0], score: 90 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/trend`,
      headers: user.auth,
    });

    const series = res.json().data.series;
    expect(series.map((s: { examName: string }) => s.examName)).toEqual(['一', '二']);
    expect(series[0].avg).toBe(60);
    expect(series[1].avg).toBe(90);
  });

  it('filters the trend by subject, leaving other subjects off the series', async () => {
    const math = await createExam({ name: '数学月考', subject: '数学', examDate: '2026-09-01' });
    const chinese = await createExam({ name: '语文月考', subject: '语文', examDate: '2026-09-02' });
    await putScores(math, [{ studentId: studentIds[0], score: 80 }]);
    await putScores(chinese, [{ studentId: studentIds[0], score: 70 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/trend?subject=${encodeURIComponent('数学')}`,
      headers: user.auth,
    });

    const series = res.json().data.series;
    expect(series).toHaveLength(1);
    expect(series[0].examName).toBe('数学月考');
  });

  it('subject=__none__ matches only exams with no subject set', async () => {
    const noSubject = await createExam({ name: '临时测验', subject: null, examDate: '2026-09-01' });
    const math = await createExam({ name: '数学月考', subject: '数学', examDate: '2026-09-02' });
    await putScores(noSubject, [{ studentId: studentIds[0], score: 50 }]);
    await putScores(math, [{ studentId: studentIds[0], score: 80 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/${classId}/trend?subject=__none__`,
      headers: user.auth,
    });

    const series = res.json().data.series;
    expect(series).toHaveLength(1);
    expect(series[0].examName).toBe('临时测验');
  });

  it('compares two classes on the same exam', async () => {
    const other = await createClass(app, user, { name: '高二(5)班' });
    const otherStudents = await createStudents(app, user, other, [{ name: '外班A' }]);

    const mine = await createExam({ name: '统考' });
    await putScores(mine, [{ studentId: studentIds[0], score: 70 }]);

    const theirs = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${other}/exam-sessions`,
      headers: user.auth,
      payload: {
        name: '统考',
        examDate: '2026-09-25',
        subjects: [{ subject: '数学' }],
      },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/exams/${theirs.json().data.exams[0].id}/scores`,
      headers: user.auth,
      payload: { scores: [{ studentId: otherStudents[0], score: 90 }] },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/compare?classIds=${classId},${other}&examName=统考`,
      headers: user.auth,
    });

    const rows = res.json().data.classes;
    expect(rows).toHaveLength(2);
    expect(rows.find((r: { classId: string }) => r.classId === classId).avg).toBe(70);
    expect(rows.find((r: { classId: string }) => r.classId === other).avg).toBe(90);
  });
});

describe('analytics: student dimension', () => {
  it('AC-13: renders a single-point trend without failing', async () => {
    const examId = await createExam();
    await putScores(examId, [
      { studentId: studentIds[0], score: 88 },
      { studentId: studentIds[1], score: 70 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentIds[0]}`,
      headers: user.auth,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.trend).toHaveLength(1);
    expect(data.summary.examCount).toBe(1);
    expect(data.summary.stddev).toBe(0);
    expect(data.trend[0].classAvg).toBe(79);
  });

  it('returns an empty trend for a student with no scores', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentIds[0]}`,
      headers: user.auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.trend).toHaveLength(0);
    expect(res.json().data.summary.avgScore).toBeNull();
  });

  it('tracks score and rank across exams', async () => {
    const a = await createExam({ name: '一', examDate: '2026-09-01' });
    const b = await createExam({ name: '二', examDate: '2026-10-01' });

    await putScores(a, [
      { studentId: studentIds[0], score: 60 },
      { studentId: studentIds[1], score: 90 },
    ]);
    await putScores(b, [
      { studentId: studentIds[0], score: 95 },
      { studentId: studentIds[1], score: 70 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentIds[0]}`,
      headers: user.auth,
    });

    const data = res.json().data;
    expect(data.trend.map((t: { rank: number }) => t.rank)).toEqual([2, 1]);
    expect(data.summary.bestRank).toBe(1);
    expect(data.summary.bestScore).toBe(95);
    expect(data.summary.worstScore).toBe(60);
  });

  it('excludes exams the student was absent from', async () => {
    const a = await createExam({ name: '一', examDate: '2026-09-01' });
    const b = await createExam({ name: '二', examDate: '2026-10-01' });

    await putScores(a, [{ studentId: studentIds[0], score: 80 }]);
    await putScores(b, [{ studentId: studentIds[0], score: null, isAbsent: true }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentIds[0]}`,
      headers: user.auth,
    });

    expect(res.json().data.trend).toHaveLength(1);
    expect(res.json().data.trend[0].examName).toBe('一');
  });

  it('builds a per-subject radar from the latest exam of each subject', async () => {
    const math = await createExam({ name: '数学月考', subject: '数学', examDate: '2026-09-01' });
    const physics = await createExam({ name: '物理月考', subject: '物理', examDate: '2026-09-02' });

    await putScores(math, [
      { studentId: studentIds[0], score: 88 },
      { studentId: studentIds[1], score: 68 },
    ]);
    await putScores(physics, [
      { studentId: studentIds[0], score: 76 },
      { studentId: studentIds[1], score: 72 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentIds[0]}`,
      headers: user.auth,
    });

    const radar = res.json().data.subjectRadar;
    expect(radar.map((r: { subject: string }) => r.subject).sort()).toEqual(['数学', '物理']);
    expect(radar.find((r: { subject: string }) => r.subject === '数学').zScore).toBeGreaterThan(0);
  });

  it('lists distinct subjects and filters the trend to one subject', async () => {
    const math = await createExam({ name: '数学月考', subject: '数学', examDate: '2026-09-01' });
    const physics = await createExam({ name: '物理月考', subject: '物理', examDate: '2026-09-02' });

    await putScores(math, [{ studentId: studentIds[0], score: 88 }]);
    await putScores(physics, [{ studentId: studentIds[0], score: 76 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentIds[0]}?subject=数学`,
      headers: user.auth,
    });

    const data = res.json().data;
    expect(data.subjects.sort()).toEqual(['数学', '物理']);
    // Filtered to just 数学: mixing subjects into one trend/rank line is
    // misleading since full scores and difficulty differ across subjects.
    expect(data.trend).toHaveLength(1);
    expect(data.trend[0].subject).toBe('数学');
    expect(data.summary.avgScore).toBe(88);
  });

  it('subject=__all__ returns every subject mixed, for the comparison chart', async () => {
    const math = await createExam({ name: '数学月考', subject: '数学', examDate: '2026-09-01' });
    const physics = await createExam({ name: '物理月考', subject: '物理', examDate: '2026-09-02' });

    await putScores(math, [{ studentId: studentIds[0], score: 88 }]);
    await putScores(physics, [{ studentId: studentIds[0], score: 76 }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentIds[0]}?subject=__all__`,
      headers: user.auth,
    });

    expect(res.json().data.trend).toHaveLength(2);
  });
});

describe('exports', () => {
  it('exports a score sheet as CSV with a BOM and an absence marker', async () => {
    const examId = await createExam({ name: '月考' });
    await putScores(examId, [
      { studentId: studentIds[0], score: 88 },
      { studentId: studentIds[1], score: null, isAbsent: true },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/class/${classId}/scores`,
      headers: user.auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    // Excel needs the BOM to detect UTF-8 for the Chinese headers.
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    expect(res.body).toContain('张三');
    expect(res.body).toContain('缺考');
  });

  it('exports the student roster as a styled workbook', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/class/${classId}/students`,
      headers: user.auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(res.rawPayload as any);
    const sheet = workbook.getWorksheet('学生名册');
    expect(sheet).toBeTruthy();

    const values = sheet!
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string');
    expect(values).toContain('学号');
    expect(values).toContain('张三');
  });
});
