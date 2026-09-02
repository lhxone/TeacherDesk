/**
 * Seeds a demo teacher with a realistic class so the UI has something to show.
 * Idempotent: re-running replaces the demo user's data.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateInviteCode } from '../src/lib/auth.js';

const prisma = new PrismaClient();

const EMAIL = 'demo@teacherdesk.app';
const PASSWORD = 'Demo12345';

const NAMES = [
  '张伟', '王芳', '李娜', '刘洋', '陈静', '杨帆', '赵磊', '黄敏',
  '周杰', '吴桐', '徐强', '孙丽', '马超', '朱琳', '胡军', '郭燕',
  '林峰', '何萍', '高翔', '罗颖', '梁辉', '宋佳', '唐勇', '许倩',
  '韩雪', '冯刚', '邓超', '曹颖', '彭涛', '曾莉', '谢军', '苏芮',
];

function randomScore(base: number, spread: number, full = 100): number {
  const v = base + (Math.random() - 0.5) * spread * 2;
  return Math.round(Math.max(0, Math.min(full, v)) * 2) / 2;
}

async function main() {
  const existing = await prisma.user.findFirst({ where: { email: EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log('removed previous demo data');
  }

  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      displayName: '演示老师',
      inviteCode: generateInviteCode(),
      settings: {
        periodsPerDay: 8,
        showWeekend: false,
        periodTimes: [
          ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
          ['14:00', '14:45'], ['14:55', '15:40'], ['16:00', '16:45'], ['16:55', '17:40'],
        ],
        gradeThresholds: { excellent: 0.85, good: 0.75, pass: 0.6 },
      },
    },
  });

  const tagFocus = await prisma.tag.create({
    data: { userId: user.id, name: '需关注', color: '#F59E0B' },
  });
  const tagRep = await prisma.tag.create({
    data: { userId: user.id, name: '课代表', color: '#10B981' },
  });

  const classA = await prisma.class.create({
    data: {
      userId: user.id,
      name: '高二(3)班',
      subject: '数学',
      academicYear: '2026-2027',
      color: '#3B82F6',
    },
  });

  const classB = await prisma.class.create({
    data: {
      userId: user.id,
      name: '高二(5)班',
      subject: '数学',
      academicYear: '2026-2027',
      color: '#10B981',
    },
  });

  // 32 students in class A, 28 in class B.
  const studentsA = await Promise.all(
    NAMES.map((name, i) =>
      prisma.student.create({
        data: {
          classId: classA.id,
          name,
          studentNo: String(i + 1).padStart(2, '0'),
          gender: i % 2 === 0 ? 'male' : 'female',
          sortOrder: i + 1,
        },
      }),
    ),
  );

  const studentsB = await Promise.all(
    NAMES.slice(0, 28).map((name, i) =>
      prisma.student.create({
        data: {
          classId: classB.id,
          name: `${name}B`,
          studentNo: String(i + 1).padStart(2, '0'),
          gender: i % 2 === 1 ? 'male' : 'female',
          sortOrder: i + 1,
        },
      }),
    ),
  );

  await prisma.studentTag.createMany({
    data: [
      { studentId: studentsA[0].id, tagId: tagRep.id },
      { studentId: studentsA[3].id, tagId: tagFocus.id },
      { studentId: studentsA[7].id, tagId: tagFocus.id },
    ],
  });

  // Four exams with a mild upward trend so the charts have shape.
  const examSpecs = [
    { name: '第一次月考', date: '2026-09-25', type: 'unit', base: 72 },
    { name: '期中考试', date: '2026-10-30', type: 'midterm', base: 75 },
    { name: '第二次月考', date: '2026-11-27', type: 'unit', base: 78 },
    { name: '期末考试', date: '2026-12-25', type: 'final', base: 80 },
  ];

  for (const spec of examSpecs) {
    for (const [cls, roster] of [
      [classA, studentsA],
      [classB, studentsB],
    ] as const) {
      const session = await prisma.examSession.create({
        data: {
          classId: cls.id,
          name: spec.name,
          examType: spec.type,
          examDate: new Date(spec.date),
        },
      });

      const exam = await prisma.exam.create({
        data: {
          classId: cls.id,
          examSessionId: session.id,
          name: spec.name,
          subject: '数学',
          examType: spec.type,
          examDate: new Date(spec.date),
          fullScore: 100,
        },
      });

      await prisma.score.createMany({
        data: roster.map((s, i) => {
          // Give each student a stable personal offset so trends look coherent.
          const personal = ((i * 37) % 25) - 12;
          const absent = spec.type === 'unit' && i === 5;
          return {
            examId: exam.id,
            studentId: s.id,
            score: absent ? null : randomScore(spec.base + personal, 8),
            isAbsent: absent,
          };
        }),
      });
    }
  }

  // Recompute stats cache for every seeded exam.
  const allExams = await prisma.exam.findMany({ include: { scores: true } });
  for (const e of allExams) {
    const vals = e.scores
      .filter((s) => !s.isAbsent && s.score !== null)
      .map((s) => Number(s.score));
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((acc, v) => acc + (v - avg) ** 2, 0) / vals.length;

    await prisma.exam.update({
      where: { id: e.id },
      data: {
        statsCache: {
          count: vals.length,
          attended: vals.length,
          absent: e.scores.filter((s) => s.isAbsent).length,
          total: e.scores.length,
          avg: Math.round(avg * 100) / 100,
          max: Math.max(...vals),
          min: Math.min(...vals),
          stddev: Math.round(Math.sqrt(variance) * 100) / 100,
          passRate: vals.filter((v) => v >= 60).length / vals.length,
          excellentRate: vals.filter((v) => v >= 85).length / vals.length,
          computedAt: new Date().toISOString(),
        },
      },
    });
  }

  // A weekly timetable for class A plus one alternating-week lesson.
  const slots = [
    { weekday: 1, period: 1, classId: classA.id, rule: 'weekly' },
    { weekday: 1, period: 3, classId: classB.id, rule: 'weekly' },
    { weekday: 2, period: 2, classId: classA.id, rule: 'weekly' },
    { weekday: 3, period: 1, classId: classB.id, rule: 'weekly' },
    { weekday: 3, period: 4, classId: classA.id, rule: 'odd_week' },
    { weekday: 4, period: 2, classId: classA.id, rule: 'weekly' },
    { weekday: 5, period: 3, classId: classB.id, rule: 'weekly' },
  ];

  await prisma.scheduleSlot.createMany({
    data: slots.map((s) => ({
      userId: user.id,
      classId: s.classId,
      subject: '数学',
      weekday: s.weekday,
      period: s.period,
      repeatRule: s.rule,
      location: '教学楼A301',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-01-15'),
    })),
  });

  const today = new Date();
  await prisma.event.createMany({
    data: [
      {
        userId: user.id,
        classId: classA.id,
        title: '收数学作业本',
        startAt: new Date(today.setHours(9, 0, 0, 0)),
      },
      {
        userId: user.id,
        classId: classA.id,
        title: '家长会准备材料',
        startAt: new Date(new Date().setHours(15, 0, 0, 0)),
      },
    ],
  });

  // An active seating chart for class A with everyone placed.
  const chart = await prisma.seatingChart.create({
    data: {
      classId: classA.id,
      name: '日常版',
      rowCount: 6,
      colCount: 6,
      layout: { podium: 'top', disabledCells: [] },
      isActive: true,
    },
  });

  await prisma.seatAssignment.createMany({
    data: studentsA.map((s, i) => ({
      seatingChartId: chart.id,
      studentId: s.id,
      rowIndex: Math.floor(i / 6),
      colIndex: i % 6,
      isPinned: i === 3,
    })),
  });

  console.log(`seeded demo user: ${EMAIL} / ${PASSWORD}`);
  console.log(`  ${studentsA.length + studentsB.length} students, ${allExams.length} exams`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
