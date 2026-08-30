/**
 * Ownership guards. Every business resource must resolve back to the
 * authenticated user (ER.md §3). These helpers are the ONLY sanctioned way to
 * load a resource by id inside a request.
 *
 * They deliberately throw 403 for both "not yours" and "does not exist" so that
 * IDs cannot be probed for existence (API.md §0.2, AC-2).
 */
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';

export async function requireClass(classId: string, userId: string) {
  const cls = await prisma.class.findFirst({
    where: { id: classId, userId, deletedAt: null },
  });
  if (!cls) throw ApiError.forbidden();
  return cls;
}

export async function requireStudent(studentId: string, userId: string) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, deletedAt: null, class: { userId, deletedAt: null } },
    include: { class: true },
  });
  if (!student) throw ApiError.forbidden();
  return student;
}

export async function requireSeatingChart(chartId: string, userId: string) {
  const chart = await prisma.seatingChart.findFirst({
    where: { id: chartId, deletedAt: null, class: { userId, deletedAt: null } },
    include: { class: true },
  });
  if (!chart) throw ApiError.forbidden();
  return chart;
}

export async function requireExam(examId: string, userId: string) {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, deletedAt: null, class: { userId, deletedAt: null } },
    include: { class: true },
  });
  if (!exam) throw ApiError.forbidden();
  return exam;
}

export async function requireTag(tagId: string, userId: string) {
  const tag = await prisma.tag.findFirst({ where: { id: tagId, userId } });
  if (!tag) throw ApiError.forbidden();
  return tag;
}

export async function requireEvent(eventId: string, userId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, userId, deletedAt: null },
  });
  if (!event) throw ApiError.forbidden();
  return event;
}

export async function requireSlot(slotId: string, userId: string) {
  const slot = await prisma.scheduleSlot.findFirst({
    where: { id: slotId, userId, deletedAt: null },
  });
  if (!slot) throw ApiError.forbidden();
  return slot;
}

export async function requireGroupingPlan(planId: string, userId: string) {
  const plan = await prisma.groupingPlan.findFirst({
    where: { id: planId, deletedAt: null, class: { userId, deletedAt: null } },
    include: { class: true },
  });
  if (!plan) throw ApiError.forbidden();
  return plan;
}

export async function requirePushSubscription(id: string, userId: string) {
  const sub = await prisma.pushSubscription.findFirst({ where: { id, userId } });
  if (!sub) throw ApiError.forbidden();
  return sub;
}

export async function requireRefreshTokenRow(id: string, userId: string) {
  const row = await prisma.refreshToken.findFirst({ where: { id, userId } });
  if (!row) throw ApiError.forbidden();
  return row;
}

/** Assert every id belongs to the given class (used by bulk seat/group writes). */
export async function assertStudentsInClass(studentIds: string[], classId: string) {
  if (studentIds.length === 0) return;
  const unique = [...new Set(studentIds)];
  const count = await prisma.student.count({
    where: { id: { in: unique }, classId, deletedAt: null },
  });
  if (count !== unique.length) {
    throw ApiError.businessRule('包含不属于该班级的学生');
  }
}
