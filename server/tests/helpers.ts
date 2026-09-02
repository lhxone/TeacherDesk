import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { resetAllLoginFailures } from '../src/lib/auth.js';

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Truncate every table between tests; RESTART IDENTITY keeps sequences clean. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      group_members, groups, grouping_plans,
      lottery_records, scores, exams, exam_sessions,
      seat_assignments, seating_charts,
      student_tags, tags, students,
      events, schedule_slots, classes,
      refresh_tokens, users
    RESTART IDENTITY CASCADE;
  `);
  resetAllLoginFailures();
  // A fresh table means the bootstrap invite code is usable again; forget any
  // cached seed user from a previous test so the next registerUser() call
  // re-derives it instead of reusing a now-deleted user's invite code.
  seedInviteCode = null;
}

let userCounter = 0;

export type TestUser = {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  auth: { authorization: string };
  inviteCode: string;
};

// Registration now requires an invite code. Tests that don't care about the
// invite mechanics just want *a* working account, so the first registerUser()
// call in a test (after resetDb()) bootstraps one seed user with
// INITIAL_INVITE_CODE, and every subsequent call defaults to that seed user's
// own invite code — most existing call sites don't need to change.
let seedInviteCode: string | null = null;

async function resolveInviteCode(app: FastifyInstance): Promise<string> {
  if (seedInviteCode) return seedInviteCode;

  if (!config.initialInviteCode) {
    throw new Error('INITIAL_INVITE_CODE must be set for tests (see server/.env.test)');
  }

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: `seed${++userCounter}@example.com`,
      password: 'Passw0rd123',
      displayName: '种子老师',
      inviteCode: config.initialInviteCode,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`seed registration failed: ${res.statusCode} ${res.body}`);
  }
  seedInviteCode = res.json().data.user.inviteCode;
  return seedInviteCode!;
}

export async function registerUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; displayName: string; inviteCode: string }> = {},
): Promise<TestUser> {
  const email = overrides.email ?? `teacher${++userCounter}@example.com`;
  const password = overrides.password ?? 'Passw0rd123';
  const inviteCode = overrides.inviteCode ?? (await resolveInviteCode(app));

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password, displayName: overrides.displayName ?? '测试老师', inviteCode },
  });

  if (res.statusCode !== 201) {
    throw new Error(`registerUser failed: ${res.statusCode} ${res.body}`);
  }

  const body = res.json().data;
  return {
    id: body.user.id,
    email,
    password,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    auth: { authorization: `Bearer ${body.accessToken}` },
    inviteCode: body.user.inviteCode,
  };
}

export async function createClass(
  app: FastifyInstance,
  user: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/classes',
    headers: user.auth,
    payload: { name: '高二(3)班', academicYear: '2026-2027', subject: '数学', ...overrides },
  });
  if (res.statusCode !== 201) throw new Error(`createClass failed: ${res.body}`);
  return res.json().data.id;
}

export async function createStudents(
  app: FastifyInstance,
  user: TestUser,
  classId: string,
  students: { name: string; studentNo?: string; gender?: string }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const s of students) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/classes/${classId}/students`,
      headers: user.auth,
      payload: s,
    });
    if (res.statusCode !== 201) throw new Error(`createStudent failed: ${res.body}`);
    ids.push(res.json().data.id);
  }
  return ids;
}

/**
 * Build a minimal multipart/form-data body carrying one file field named
 * "file", for exercising @fastify/multipart-backed import-file endpoints via
 * app.inject (which has no native multipart helper).
 */
export function multipartFile(
  buffer: Buffer,
  filename: string,
  contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = '----testboundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, buffer, tail]),
  };
}

/** Deterministic RNG for tests that need reproducible shuffles. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export { prisma };
