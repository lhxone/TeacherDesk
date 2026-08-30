import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, prisma, registerUser, resetDb } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

describe('auth: registration', () => {
  it('creates an account and returns tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@example.com', password: 'Passw0rd123', displayName: '李老师' },
    });

    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.user.email).toBe('new@example.com');
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toMatch(/^rt_/);
    expect(data.user).not.toHaveProperty('passwordHash');
  });

  it('never stores the password in plain text', async () => {
    await registerUser(app, { email: 'hash@example.com', password: 'Passw0rd123' });
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'hash@example.com' } });

    expect(user.passwordHash).not.toBe('Passw0rd123');
    expect(user.passwordHash.startsWith('$2')).toBe(true);
  });

  it('normalises the email to lower case', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'MiXeD@Example.COM', password: 'Passw0rd123', displayName: 'T' },
    });
    expect(res.json().data.user.email).toBe('mixed@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerUser(app, { email: 'dup@example.com' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'dup@example.com', password: 'Passw0rd123', displayName: 'X' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it.each([
    ['short', 'Pw1', '长度'],
    ['letters only', 'PasswordOnly', '字母和数字'],
    ['digits only', '12345678', '字母和数字'],
  ])('rejects a weak password (%s)', async (_label, password) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `weak${_label.replace(/\s/g, '')}@example.com`, password, displayName: 'X' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'Passw0rd123', displayName: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('auth: login', () => {
  it('accepts correct credentials', async () => {
    const user = await registerUser(app, { email: 'login@example.com' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: user.password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.accessToken).toBeTruthy();
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const user = await registerUser(app, { email: 'known@example.com' });

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'WrongPass123' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'WrongPass123' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    // Identical message: the endpoint must not reveal which emails exist.
    expect(wrongPassword.json().error.message).toBe(unknownEmail.json().error.message);
  });

  it('locks the account after 5 consecutive failures', async () => {
    const user = await registerUser(app, { email: 'lock@example.com' });

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'WrongPass123' },
      });
    }

    // Even the correct password is refused while locked.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: user.password },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('clears the failure counter after a successful login', async () => {
    const user = await registerUser(app, { email: 'clear@example.com' });

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'WrongPass123' },
      });
    }

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: user.password },
    });

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: 'WrongPass123' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: user.password },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('auth: token lifecycle', () => {
  it('AC-1: rejects an unauthenticated request to a protected route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/classes' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/classes',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows the health check without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const user = await registerUser(app);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(first.statusCode).toBe(200);
    const rotated = first.json().data.refreshToken;
    expect(rotated).not.toBe(user.refreshToken);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('revokes the whole token family when a rotated token is replayed', async () => {
    const user = await registerUser(app);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    const rotated = first.json().data.refreshToken;

    // Replay the already-rotated token: treated as compromise.
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });

    // The legitimately-rotated token must now be dead too.
    const afterBreach = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: rotated },
    });
    expect(afterBreach.statusCode).toBe(401);
  });

  it('rejects an expired refresh token', async () => {
    const user = await registerUser(app);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logout revokes the presented refresh token', async () => {
    const user = await registerUser(app);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: user.auth,
      payload: { refreshToken: user.refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('auth: profile', () => {
  it('returns the current user with merged default settings', async () => {
    const user = await registerUser(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: user.auth });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.id).toBe(user.id);
    expect(data.settings.gradeThresholds.excellent).toBe(0.85);
    expect(data.settings.periodsPerDay).toBe(8);
  });

  it('merges partial settings updates instead of replacing the object', async () => {
    const user = await registerUser(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: user.auth,
      payload: { settings: { periodsPerDay: 9 } },
    });

    const settings = res.json().data.settings;
    expect(settings.periodsPerDay).toBe(9);
    // Untouched keys must survive.
    expect(settings.gradeThresholds.excellent).toBe(0.85);
  });

  it('changing the password revokes every existing refresh token', async () => {
    const user = await registerUser(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: user.auth,
      payload: { currentPassword: user.password, newPassword: 'NewPassw0rd456' },
    });
    expect(res.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'NewPassw0rd456' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rejects a password change with the wrong current password', async () => {
    const user = await registerUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: user.auth,
      payload: { currentPassword: 'NotMyPass123', newPassword: 'NewPassw0rd456' },
    });
    expect(res.statusCode).toBe(400);
  });
});
