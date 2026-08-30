/**
 * Data-isolation tests: user A must never reach user B's data (ER.md §3, AC-2).
 * Every owned resource type gets a cross-tenant probe.
 */
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
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  alice = await registerUser(app, { email: 'alice@example.com' });
  bob = await registerUser(app, { email: 'bob@example.com' });
});

describe('isolation: classes', () => {
  it('AC-2: reading another user\'s class returns 403', async () => {
    const classId = await createClass(app, alice);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}`,
      headers: bob.auth,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('AC-2: a nonexistent id and a foreign id are indistinguishable', async () => {
    const classId = await createClass(app, alice);
    const ghostId = '00000000-0000-4000-8000-000000000000';

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}`,
      headers: bob.auth,
    });
    const ghost = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${ghostId}`,
      headers: bob.auth,
    });

    expect(foreign.statusCode).toBe(ghost.statusCode);
    expect(foreign.json().error.message).toBe(ghost.json().error.message);
  });

  it('does not list another user\'s classes', async () => {
    await createClass(app, alice, { name: 'Alice 的班' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/classes', headers: bob.auth });

    expect(res.json().data).toHaveLength(0);
  });

  it('refuses to update or delete a foreign class', async () => {
    const classId = await createClass(app, alice);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/classes/${classId}`,
      headers: bob.auth,
      payload: { name: 'hijacked' },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/classes/${classId}`,
      headers: bob.auth,
    });

    expect(patch.statusCode).toBe(403);
    expect(del.statusCode).toBe(403);

    const still = await prisma.class.findFirstOrThrow({ where: { id: classId } });
    expect(still.name).not.toBe('hijacked');
    expect(still.deletedAt).toBeNull();
  });
});

describe('isolation: students', () => {
  it('refuses to list students of a foreign class', async () => {
    const classId = await createClass(app, alice);
    await createStudents(app, alice, classId, [{ name: '张三' }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/students`,
      headers: bob.auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to read a foreign student directly', async () => {
    const classId = await createClass(app, alice);
    const [studentId] = await createStudents(app, alice, classId, [{ name: '张三' }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/students/${studentId}`,
      headers: bob.auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to add a student to a foreign class', async () => {
    const classId = await createClass(app, alice);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students`,
      headers: bob.auth,
      payload: { name: '入侵者' },
    });

    expect(res.statusCode).toBe(403);
    expect(await prisma.student.count({ where: { classId } })).toBe(0);
  });
});

describe('isolation: tags', () => {
  it('refuses to attach another user\'s tag to your own student', async () => {
    const bobTag = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: bob.auth,
      payload: { name: 'Bob 的标签' },
    });
    const tagId = bobTag.json().data.id;

    const aliceClass = await createClass(app, alice);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${aliceClass}/students`,
      headers: alice.auth,
      payload: { name: '张三', tagIds: [tagId] },
    });

    expect(res.statusCode).toBe(403);
  });

  it('scopes the tag list per user', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: alice.auth,
      payload: { name: '课代表' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/tags', headers: bob.auth });
    expect(res.json().data).toHaveLength(0);
  });
});

describe('isolation: exams and scores', () => {
  it('refuses to read a foreign exam\'s score sheet', async () => {
    const classId = await createClass(app, alice);
    const exam = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/exams`,
      headers: alice.auth,
      payload: { name: '月考', examDate: '2026-09-25', subject: '数学' },
    });
    const examId = exam.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores`,
      headers: bob.auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to write scores into a foreign exam', async () => {
    const classId = await createClass(app, alice);
    const [studentId] = await createStudents(app, alice, classId, [{ name: '张三' }]);
    const exam = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/exams`,
      headers: alice.auth,
      payload: { name: '月考', examDate: '2026-09-25' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/exams/${exam.json().data.id}/scores`,
      headers: bob.auth,
      payload: { scores: [{ studentId, score: 100 }] },
    });

    expect(res.statusCode).toBe(403);
    expect(await prisma.score.count()).toBe(0);
  });

  it('refuses cross-class score writes even for your own exam', async () => {
    const aliceClass = await createClass(app, alice);
    const otherClass = await createClass(app, alice, { name: '另一个班' });
    const [outsider] = await createStudents(app, alice, otherClass, [{ name: '外班学生' }]);

    const exam = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${aliceClass}/exams`,
      headers: alice.auth,
      payload: { name: '月考', examDate: '2026-09-25' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/exams/${exam.json().data.id}/scores`,
      headers: alice.auth,
      payload: { scores: [{ studentId: outsider, score: 90 }] },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('isolation: analytics', () => {
  it('refuses analytics on a foreign student', async () => {
    const classId = await createClass(app, alice);
    const [studentId] = await createStudents(app, alice, classId, [{ name: '张三' }]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/student/${studentId}`,
      headers: bob.auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a class comparison that includes a foreign class', async () => {
    const aliceClass = await createClass(app, alice);
    const bobClass = await createClass(app, bob);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/class/compare?classIds=${bobClass},${aliceClass}`,
      headers: bob.auth,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('isolation: exports', () => {
  it('refuses to export a foreign class roster', async () => {
    const classId = await createClass(app, alice);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/class/${classId}/students`,
      headers: bob.auth,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('isolation: push subscriptions', () => {
  it('one teacher cannot delete another teacher\'s device subscription', async () => {
    const endpoint = 'https://push.example.com/alice-device';
    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      headers: alice.auth,
      payload: { endpoint, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(20) } },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/push/subscriptions',
      headers: bob.auth,
      payload: { endpoint },
    });

    // Idempotent delete returns 204 either way, but Alice's row must survive.
    expect(res.statusCode).toBe(204);
    expect(await prisma.pushSubscription.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('re-subscribing the same endpoint as another user reassigns it, not duplicates it', async () => {
    const endpoint = 'https://push.example.com/shared-browser';
    const keys = { p256dh: 'p'.repeat(20), auth: 'a'.repeat(20) };

    await app.inject({ method: 'POST', url: '/api/v1/push/subscriptions',
      headers: alice.auth, payload: { endpoint, keys } });
    await app.inject({ method: 'POST', url: '/api/v1/push/subscriptions',
      headers: bob.auth, payload: { endpoint, keys } });

    expect(await prisma.pushSubscription.count()).toBe(1);
    const row = await prisma.pushSubscription.findFirstOrThrow();
    expect(row.userId).toBe(bob.id);
  });
});
