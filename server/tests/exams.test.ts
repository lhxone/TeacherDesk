import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createClass, createTestApp, prisma, registerUser, resetDb, type TestUser } from './helpers.js';

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

async function createSession(overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/classes/${classId}/exam-sessions`,
    headers: user.auth,
    payload: {
      name: '第一次月考',
      examType: 'midterm',
      examDate: '2026-09-25',
      subjects: [
        { subject: '语文', fullScore: 120 },
        { subject: '数学', fullScore: 150 },
      ],
      ...overrides,
    },
  });
}

describe('exam sessions', () => {
  it('creates one exam row per subject under a shared session', async () => {
    const res = await createSession();
    expect(res.statusCode).toBe(201);

    const body = res.json().data;
    expect(body.name).toBe('第一次月考');
    expect(body.exams).toHaveLength(2);
    expect(body.exams.map((e: { subject: string }) => e.subject).sort()).toEqual(['数学', '语文']);
    expect(body.exams[0].examSessionId).toBe(body.id);
    expect(body.exams.find((e: { subject: string }) => e.subject === '数学').fullScore).toBe(150);
  });

  it('rejects a session with no subjects', async () => {
    const res = await createSession({ subjects: [] });
    expect(res.statusCode).toBe(400);
  });

  it('lists sessions with their nested subject exams', async () => {
    await createSession();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/exam-sessions`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].exams).toHaveLength(2);
  });

  it('still lists a flat per-subject exam list for analytics/tools', async () => {
    await createSession();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/exams`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it('adds a subject to an existing session', async () => {
    const session = await createSession();
    const sessionId = session.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exam-sessions/${sessionId}/exams`,
      headers: user.auth,
      payload: { subject: '英语', fullScore: 120 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.examSessionId).toBe(sessionId);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/exam-sessions/${sessionId}`,
      headers: user.auth,
    });
    expect(list.json().data.exams).toHaveLength(3);
  });

  it('cascades a session rename/date change onto every subject exam', async () => {
    const session = await createSession();
    const sessionId = session.json().data.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/exam-sessions/${sessionId}`,
      headers: user.auth,
      payload: { name: '第一次月考（改）', examDate: '2026-09-26' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exam-sessions/${sessionId}`,
      headers: user.auth,
    });
    const body = res.json().data;
    expect(body.name).toBe('第一次月考（改）');
    expect(body.examDate).toBe('2026-09-26');
    for (const e of body.exams) {
      expect(e.name).toBe('第一次月考（改）');
      expect(e.examDate).toBe('2026-09-26');
    }
  });

  it('edits only subject/fullScore/note on a single exam, leaving name/date alone', async () => {
    const session = await createSession();
    const examId = session.json().data.exams[0].id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/exams/${examId}`,
      headers: user.auth,
      payload: { subject: '语文（改）', fullScore: 100 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.subject).toBe('语文（改）');
    expect(res.json().data.fullScore).toBe(100);
    expect(res.json().data.name).toBe('第一次月考');
  });

  it('deletes a single subject exam while keeping the session and its siblings', async () => {
    const session = await createSession();
    const examId = session.json().data.exams[0].id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/exams/${examId}`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/exam-sessions/${session.json().data.id}`,
      headers: user.auth,
    });
    expect(list.json().data.exams).toHaveLength(1);
  });

  it('refuses to delete the last remaining subject exam in a session', async () => {
    const session = await createSession({ subjects: [{ subject: '数学' }] });
    const examId = session.json().data.exams[0].id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/exams/${examId}`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(422);
    expect(await prisma.exam.count({ where: { deletedAt: null } })).toBe(1);
  });

  it('deleting a session cascades to soft-delete every subject exam', async () => {
    const session = await createSession();
    const sessionId = session.json().data.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/exam-sessions/${sessionId}`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(204);

    expect(await prisma.exam.count({ where: { examSessionId: sessionId, deletedAt: null } })).toBe(0);
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/classes/${classId}/exam-sessions`,
      headers: user.auth,
    });
    expect(list.json().data).toHaveLength(0);
  });
});

describe('isolation: exam sessions', () => {
  it('refuses to read a foreign exam session', async () => {
    const other = await registerUser(app);
    const session = await createSession();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exam-sessions/${session.json().data.id}`,
      headers: other.auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to add a subject to a foreign exam session', async () => {
    const other = await registerUser(app);
    const session = await createSession();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exam-sessions/${session.json().data.id}/exams`,
      headers: other.auth,
      payload: { subject: '英语' },
    });
    expect(res.statusCode).toBe(403);
  });
});
