import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createClass,
  createStudents,
  createTestApp,
  prisma,
  registerUser,
  resetDb,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let user: TestUser;
let classId: string;
let studentIds: string[];

async function createChart(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/classes/${classId}/seating-charts`,
    headers: user.auth,
    payload: { name: '日常版', rowCount: 4, colCount: 4, ...overrides },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().data.id;
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
  studentIds = await createStudents(
    app,
    user,
    classId,
    Array.from({ length: 12 }, (_, i) => ({
      name: `学生${i}`,
      studentNo: String(i + 1).padStart(2, '0'),
      gender: i % 2 === 0 ? 'male' : 'female',
    })),
  );
});

describe('seating: charts', () => {
  it('creates a chart and lists unassigned students', async () => {
    const chartId = await createChart();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/seating-charts/${chartId}`,
      headers: user.auth,
    });

    expect(res.json().data.assignments).toHaveLength(0);
    expect(res.json().data.unassignedStudents).toHaveLength(12);
  });

  it('keeps only one active chart per class', async () => {
    const first = await createChart({ name: '方案A', isActive: true });
    const second = await createChart({ name: '方案B', isActive: true });

    const charts = await prisma.seatingChart.findMany({ where: { classId, isActive: true } });
    expect(charts).toHaveLength(1);
    expect(charts[0].id).toBe(second);
    expect(first).not.toBe(charts[0].id);
  });

  it('saves a seating arrangement', async () => {
    const chartId = await createChart();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/seating-charts/${chartId}/assignments`,
      headers: user.auth,
      payload: {
        assignments: [
          { studentId: studentIds[0], rowIndex: 0, colIndex: 0 },
          { studentId: studentIds[1], rowIndex: 0, colIndex: 1, isPinned: true },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.saved).toBe(2);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/seating-charts/${chartId}`,
      headers: user.auth,
    });
    expect(detail.json().data.assignments).toHaveLength(2);
    expect(detail.json().data.unassignedStudents).toHaveLength(10);
  });

  it('rejects two students on the same seat', async () => {
    const chartId = await createChart();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/seating-charts/${chartId}/assignments`,
      headers: user.auth,
      payload: {
        assignments: [
          { studentId: studentIds[0], rowIndex: 0, colIndex: 0 },
          { studentId: studentIds[1], rowIndex: 0, colIndex: 0 },
        ],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects a seat outside the grid', async () => {
    const chartId = await createChart({ rowCount: 2, colCount: 2 });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/seating-charts/${chartId}/assignments`,
      headers: user.auth,
      payload: { assignments: [{ studentId: studentIds[0], rowIndex: 5, colIndex: 0 }] },
    });

    expect(res.statusCode).toBe(422);
  });

  it('rejects a seat on a disabled cell', async () => {
    const chartId = await createChart({ layout: { disabledCells: [[1, 1]] } });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/seating-charts/${chartId}/assignments`,
      headers: user.auth,
      payload: { assignments: [{ studentId: studentIds[0], rowIndex: 1, colIndex: 1 }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('禁用格');
  });

  it('refuses to shrink a chart when seated students would fall outside', async () => {
    const chartId = await createChart({ rowCount: 4, colCount: 4 });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/seating-charts/${chartId}/assignments`,
      headers: user.auth,
      payload: { assignments: [{ studentId: studentIds[0], rowIndex: 3, colIndex: 3 }] },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/seating-charts/${chartId}`,
      headers: user.auth,
      payload: { rowCount: 2, colCount: 2 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details[0].message).toContain('超出新尺寸');
  });

  it('rejects an aisle group split whose columns do not sum to colCount', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/seating-charts`,
      headers: user.auth,
      payload: {
        name: '过道版',
        rowCount: 4,
        colCount: 6,
        layout: { aisles: { groups: [2, 2] } }, // sums to 4, not 6
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('过道分组列数之和');
  });

  it('accepts an aisle group split that sums to colCount', async () => {
    const chartId = await createChart({
      colCount: 6,
      layout: { aisles: { groups: [2, 2, 2] } },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/seating-charts/${chartId}`,
      headers: user.auth,
    });

    expect(res.json().data.layout.aisles.groups).toEqual([2, 2, 2]);
  });

  it('rejects a PATCH that breaks the aisle/colCount invariant', async () => {
    const chartId = await createChart({
      colCount: 6,
      layout: { aisles: { groups: [2, 2, 2] } },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/seating-charts/${chartId}`,
      headers: user.auth,
      payload: { colCount: 4 }, // existing aisles still sum to 6
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('过道分组列数之和');
  });
});

describe('seating: randomize', () => {
  it('seats everyone when the grid is large enough', async () => {
    const chartId = await createChart({ rowCount: 4, colCount: 4 });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/seating-charts/${chartId}/randomize`,
      headers: user.auth,
      payload: { persist: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.assignments).toHaveLength(12);
    expect(await prisma.seatAssignment.count({ where: { seatingChartId: chartId } })).toBe(12);
  });

  it('previews without persisting when persist is false', async () => {
    const chartId = await createChart();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/seating-charts/${chartId}/randomize`,
      headers: user.auth,
      payload: { persist: false },
    });

    expect(res.json().data.persisted).toBe(false);
    expect(await prisma.seatAssignment.count({ where: { seatingChartId: chartId } })).toBe(0);
  });

  it('AC-8: keeps pinned students in place', async () => {
    const chartId = await createChart();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/seating-charts/${chartId}/assignments`,
      headers: user.auth,
      payload: {
        assignments: [{ studentId: studentIds[0], rowIndex: 3, colIndex: 3, isPinned: true }],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/seating-charts/${chartId}/randomize`,
      headers: user.auth,
      payload: { keepPinned: true, persist: true },
    });

    const pinned = res
      .json()
      .data.assignments.find((a: { studentId: string }) => a.studentId === studentIds[0]);
    expect(pinned).toMatchObject({ rowIndex: 3, colIndex: 3, isPinned: true });
  });

  it('AC-9: refuses to seat more students than there are seats', async () => {
    const chartId = await createChart({ rowCount: 2, colCount: 2 }); // 4 seats, 12 students
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/seating-charts/${chartId}/randomize`,
      headers: user.auth,
      payload: { persist: true },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('座位不足');
    expect(await prisma.seatAssignment.count({ where: { seatingChartId: chartId } })).toBe(0);
  });

  it('respects podium: "bottom" from the chart layout when randomizing', async () => {
    // 6 students on a 4x4 grid with podium at the bottom: the front (last)
    // row must fill first, exercising the route's podiumOf(chart.layout) wiring.
    const chartId = await createChart({
      rowCount: 4,
      colCount: 4,
      layout: { podium: 'bottom' },
    });
    await createStudents(
      app,
      user,
      classId,
      Array.from({ length: 2 }, (_, i) => ({ name: `多${i}`, gender: 'male' as const })),
    );
    // 14 students total now; shrink grid usage isn't the point, just confirm
    // rows nearest the bottom fill before the ones nearest the top do.
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/seating-charts/${chartId}/randomize`,
      headers: user.auth,
      payload: { persist: false },
    });

    expect(res.statusCode).toBe(200);
    const assignments = res.json().data.assignments as { rowIndex: number }[];
    const row3 = assignments.filter((a) => a.rowIndex === 3).length;
    const row0 = assignments.filter((a) => a.rowIndex === 0).length;
    expect(row3).toBe(4);
    expect(row0).toBeLessThanOrEqual(row3);
  });
});

describe('lottery', () => {
  it('draws a student from the class', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/draw`,
      headers: user.auth,
      payload: { count: 1, mode: 'plain' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.students).toHaveLength(1);
    expect(studentIds).toContain(res.json().data.students[0].id);
  });

  it('draws several distinct students at once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/draw`,
      headers: user.auth,
      payload: { count: 3, mode: 'plain' },
    });

    const ids = res.json().data.students.map((s: { id: string }) => s.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('AC-10: noRepeat draws each student exactly once per round', async () => {
    const drawn: string[] = [];

    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/classes/${classId}/lottery/draw`,
        headers: user.auth,
        payload: { count: 1, mode: 'noRepeat' },
      });
      expect(res.statusCode).toBe(200);
      drawn.push(res.json().data.students[0].id);
    }

    expect(new Set(drawn).size).toBe(12);
  });

  it('AC-10: the round resets after everyone has been drawn', async () => {
    for (let i = 0; i < 12; i++) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/classes/${classId}/lottery/draw`,
        headers: user.auth,
        payload: { count: 1, mode: 'noRepeat' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/draw`,
      headers: user.auth,
      payload: { count: 1, mode: 'noRepeat' },
    });

    expect(res.json().data.roundReset).toBe(true);
  });

  it('honours an explicit round reset', async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/classes/${classId}/lottery/draw`,
        headers: user.auth,
        payload: { count: 1, mode: 'noRepeat' },
      });
    }

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/reset`,
      headers: user.auth,
    });
    expect(reset.statusCode).toBe(204);

    // A fresh round has all 12 available again.
    const drawn: string[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/classes/${classId}/lottery/draw`,
        headers: user.auth,
        payload: { count: 1, mode: 'noRepeat' },
      });
      drawn.push(res.json().data.students[0].id);
    }
    expect(new Set(drawn).size).toBe(12);
  });

  it('excludes the students the teacher marked absent', async () => {
    const excluded = studentIds.slice(0, 10);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/draw`,
      headers: user.auth,
      payload: { count: 2, mode: 'plain', excludeStudentIds: excluded },
    });

    const ids = res.json().data.students.map((s: { id: string }) => s.id);
    for (const id of ids) expect(excluded).not.toContain(id);
  });

  it('rejects drawing more students than are available', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/draw`,
      headers: user.auth,
      payload: { count: 20, mode: 'plain' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('records history and summarises draw counts', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/draw`,
      headers: user.auth,
      payload: { count: 2, mode: 'plain', record: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/lottery/records`,
      headers: user.auth,
    });

    expect(res.json().data).toHaveLength(2);
    expect(res.json().summary.reduce((a: number, s: { count: number }) => a + s.count, 0)).toBe(2);
  });

  it('skips history when record is false', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/lottery/draw`,
      headers: user.auth,
      payload: { count: 1, mode: 'plain', record: false },
    });

    expect(await prisma.lotteryRecord.count({ where: { classId } })).toBe(0);
  });
});

describe('grouping', () => {
  it('splits the class into the requested number of groups', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: { mode: 'byGroupCount', groupCount: 4 },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().data.groups;
    expect(groups).toHaveLength(4);
    expect(groups.flatMap((g: { members: unknown[] }) => g.members)).toHaveLength(12);
  });

  it('derives the group count from a target group size', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: { mode: 'byGroupSize', groupSize: 3 },
    });

    expect(res.json().data.groups).toHaveLength(4);
  });

  it('requires groupCount in byGroupCount mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: { mode: 'byGroupCount' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('persists a plan when asked and reads it back', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: { mode: 'byGroupCount', groupCount: 3, persist: true, name: '实验分组' },
    });

    const planId = res.json().data.planId;
    expect(planId).toBeTruthy();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/grouping-plans/${planId}`,
      headers: user.auth,
    });

    expect(detail.json().data.name).toBe('实验分组');
    expect(detail.json().data.groups).toHaveLength(3);
    expect(detail.json().data.groups.flatMap((g: { members: unknown[] }) => g.members)).toHaveLength(12);
  });

  it('does not persist when persist is false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: { mode: 'byGroupCount', groupCount: 3, persist: false },
    });

    expect(res.json().data.planId).toBeNull();
    expect(await prisma.groupingPlan.count()).toBe(0);
  });

  it('AC-11: balances groups by a chosen exam\'s scores', async () => {
    const session = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/exam-sessions`,
      headers: user.auth,
      payload: { name: '月考', examDate: '2026-09-25', subjects: [{ subject: '数学' }] },
    });
    const examId = session.json().data.exams[0].id;

    await app.inject({
      method: 'PUT',
      url: `/api/v1/exams/${examId}/scores`,
      headers: user.auth,
      payload: {
        scores: studentIds.map((studentId, i) => ({ studentId, score: 40 + i * 5 })),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: { mode: 'byGroupCount', groupCount: 3, balanceByExamId: examId },
    });

    const avgs = res.json().data.groups.map((g: { avgScore: number }) => g.avgScore);
    const spread = Math.max(...avgs) - Math.min(...avgs);

    // Scores 40..95 have a population sd of about 17; a snake split should
    // land the group averages far closer together than that.
    expect(spread).toBeLessThan(10);
  });

  it('honours a separatePairs constraint end to end', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: {
        mode: 'byGroupCount',
        groupCount: 3,
        separatePairs: [[studentIds[0], studentIds[1]]],
      },
    });

    expect(res.statusCode).toBe(200);
    for (const g of res.json().data.groups) {
      const ids = g.members.map((m: { id: string }) => m.id);
      expect(ids.includes(studentIds[0]) && ids.includes(studentIds[1])).toBe(false);
    }
  });

  it('excludes the requested students from grouping', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/grouping/generate`,
      headers: user.auth,
      payload: {
        mode: 'byGroupCount',
        groupCount: 2,
        excludeStudentIds: [studentIds[0], studentIds[1]],
      },
    });

    const all = res.json().data.groups.flatMap((g: { members: { id: string }[] }) => g.members);
    expect(all).toHaveLength(10);
    expect(all.map((m: { id: string }) => m.id)).not.toContain(studentIds[0]);
  });
});

describe('schedule and events', () => {
  it('AC-6: an odd-week lesson is hidden on even weeks', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: {
        classId,
        subject: '数学',
        weekday: 1,
        period: 2,
        repeatRule: 'odd_week',
        startDate: '2026-09-01',
        endDate: '2027-01-15',
      },
    });

    const oddWeek = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?date=2026-09-14',
      headers: user.auth,
    });
    const evenWeek = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?date=2026-09-21',
      headers: user.auth,
    });

    expect(oddWeek.json().data[0].lessons).toHaveLength(1);
    expect(evenWeek.json().data[0].lessons).toHaveLength(0);
  });

  it('rejects a second lesson in the same weekday/period slot', async () => {
    const payload = {
      classId,
      subject: '数学',
      weekday: 1,
      period: 2,
      repeatRule: 'weekly' as const,
    };

    await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: { ...payload, subject: '语文' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('allows an odd-week and an even-week lesson in the same slot', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: { classId, weekday: 1, period: 2, repeatRule: 'odd_week' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: { classId, weekday: 1, period: 2, repeatRule: 'even_week' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('attaches period start and end times from user settings', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/schedule/slots',
      headers: user.auth,
      payload: { classId, subject: '数学', weekday: 1, period: 2, repeatRule: 'weekly' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?date=2026-09-14',
      headers: user.auth,
    });

    const lesson = res.json().data[0].lessons[0];
    // Default daySchedule: period 2 is 09:00–09:45.
    expect(lesson.startTime).toBe('09:00');
    expect(lesson.endTime).toBe('09:45');
    expect(lesson.className).toBe('高二(3)班');
  });

  it('merges todo events into the daily agenda', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: { title: '收作业本', startAt: '2026-09-14T09:00:00.000Z', classId },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?date=2026-09-14',
      headers: user.auth,
    });

    expect(res.json().data[0].events).toHaveLength(1);
    expect(res.json().data[0].events[0].title).toBe('收作业本');
  });

  it('returns one entry per day for a date range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?from=2026-09-14&to=2026-09-18',
      headers: user.auth,
    });

    expect(res.json().data).toHaveLength(5);
  });

  it('rejects a range longer than 31 days', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?from=2026-01-01&to=2026-06-01',
      headers: user.auth,
    });

    expect(res.statusCode).toBe(400);
  });

  it('marks an event done', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: { title: '家长会', startAt: '2026-09-14T09:00:00.000Z' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${created.json().data.id}`,
      headers: user.auth,
      payload: { isDone: true },
    });

    expect(res.json().data.isDone).toBe(true);
  });

  it('projects a weekly-recurring todo onto every matching day in range', async () => {
    // "每周三值班" starting Wednesday 2026-09-16, 08:00–08:30.
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: {
        title: '值班',
        startAt: '2026-09-16T08:00:00.000Z',
        endAt: '2026-09-16T08:30:00.000Z',
        repeatWeekday: 3,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?from=2026-09-14&to=2026-09-24',
      headers: user.auth,
    });

    const byDate = new Map(res.json().data.map((d: { date: string; events: unknown[] }) => [d.date, d.events]));
    expect(byDate.get('2026-09-16')).toHaveLength(1);
    expect(byDate.get('2026-09-23')).toHaveLength(1);
    expect(byDate.get('2026-09-17')).toHaveLength(0);
    // Earlier than the todo's own start date: no occurrence yet.
    expect(byDate.get('2026-09-14')).toHaveLength(0);

    const first = (byDate.get('2026-09-16') as { startAt: string; endAt: string }[])[0];
    expect(first.startAt.slice(0, 10)).toBe('2026-09-16');
    expect(first.startAt.slice(11, 16)).toBe('08:00');
    expect(first.endAt.slice(11, 16)).toBe('08:30');
  });

  it('toggling one week of a recurring todo does not affect other weeks', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: { title: '值班', startAt: '2026-09-16T08:00:00.000Z', repeatWeekday: 3 },
    });
    const eventId = created.json().data.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}/occurrences/2026-09-16`,
      headers: user.auth,
      payload: { isDone: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/schedule/agenda?from=2026-09-16&to=2026-09-23',
      headers: user.auth,
    });
    const byDate = new Map(res.json().data.map((d: { date: string; events: { isDone: boolean }[] }) => [d.date, d.events]));

    expect((byDate.get('2026-09-16') as { isDone: boolean }[])[0].isDone).toBe(true);
    expect((byDate.get('2026-09-23') as { isDone: boolean }[])[0].isDone).toBe(false);
  });

  it('rejects toggling isDone on a recurring event via the plain PATCH endpoint', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: { title: '值班', startAt: '2026-09-16T08:00:00.000Z', repeatWeekday: 3 },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${created.json().data.id}`,
      headers: user.auth,
      payload: { isDone: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects toggling an occurrence on a non-recurring event', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: user.auth,
      payload: { title: '家长会', startAt: '2026-09-14T09:00:00.000Z' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${created.json().data.id}/occurrences/2026-09-14`,
      headers: user.auth,
      payload: { isDone: true },
    });

    expect(res.statusCode).toBe(400);
  });
});
