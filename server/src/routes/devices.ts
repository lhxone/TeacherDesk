/**
 * Device management (PRD-adjacent). Lets a teacher see every device tied to
 * their account and cut one loose:
 *   - push subscriptions (browsers / PWAs that can receive reminders)
 *   - login sessions (live refresh tokens)
 *
 * Endpoints never expose push endpoint URLs or token hashes.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../app.js';
import { pushEnabled } from '../config.js';
import { requirePushSubscription, requireRefreshTokenRow } from '../lib/ownership.js';

export async function registerDeviceRoutes(app: FastifyInstance) {
  app.get('/devices', async (req) => {
    const userId = requireUser(req);
    const now = new Date();

    const [subs, sessions] = await Promise.all([
      prisma.pushSubscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: {
        pushEnabled: pushEnabled(),
        subscriptions: subs.map((s) => ({
          id: s.id,
          label: s.label,
          userAgent: s.userAgent,
          createdAt: s.createdAt.toISOString(),
          lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          deviceInfo: s.deviceInfo,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
        })),
      },
    };
  });

  /** Forget a push subscription so this account stops delivering reminders to it. */
  app.delete('/devices/subscriptions/:id', async (req, reply) => {
    const userId = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await requirePushSubscription(id, userId);
    await prisma.pushSubscription.delete({ where: { id } });
    return reply.status(204).send();
  });

  /** Revoke a login session. That device's next API call gets a 401. */
  app.delete('/devices/sessions/:id', async (req, reply) => {
    const userId = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await requireRefreshTokenRow(id, userId);
    await prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return reply.status(204).send();
  });
}
