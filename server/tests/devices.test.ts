import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, resetDb, registerUser, prisma, type TestUser } from './helpers.js';

let app: FastifyInstance;
let user: TestUser;

beforeEach(async () => {
  await resetDb();
  app = await createTestApp();
  user = await registerUser(app);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function subscribe(u: TestUser, endpoint: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/push/subscriptions',
    headers: u.auth,
    payload: { endpoint, keys: { p256dh: 'x'.repeat(20), auth: 'y'.repeat(20) } },
  });
}

describe('GET /devices', () => {
  it('lists this account\'s push subscriptions and login sessions without leaking secrets', async () => {
    await subscribe(user, 'https://push.example.com/a');

    const res = await app.inject({ method: 'GET', url: '/api/v1/devices', headers: user.auth });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;

    expect(d.pushEnabled).toBe(false);
    expect(d.subscriptions).toHaveLength(1);
    expect(d.subscriptions[0]).not.toHaveProperty('endpoint');
    expect(d.subscriptions[0]).not.toHaveProperty('p256dh');
    expect(d.subscriptions[0].lastSeenAt).toBeTruthy();

    // The registration created one refresh-token session.
    expect(d.sessions.length).toBeGreaterThanOrEqual(1);
    expect(d.sessions[0]).not.toHaveProperty('tokenHash');
  });
});

describe('DELETE /devices/subscriptions/:id', () => {
  it('removes the caller\'s own subscription', async () => {
    await subscribe(user, 'https://push.example.com/mine');
    const sub = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: user.id } });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/subscriptions/${sub.id}`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
  });

  it('cannot delete another teacher\'s subscription', async () => {
    const other = await registerUser(app);
    await subscribe(other, 'https://push.example.com/theirs');
    const sub = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: other.id } });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/subscriptions/${sub.id}`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.pushSubscription.count({ where: { userId: other.id } })).toBe(1);
  });
});

describe('DELETE /devices/sessions/:id', () => {
  it('revokes the session so its refresh token stops working', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: user.password },
    });
    const { sessionId, refreshToken } = login.json().data;
    expect(sessionId).toBeTruthy();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/sessions/${sessionId}`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });
});
