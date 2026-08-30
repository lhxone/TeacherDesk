import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../app.js';
import { config, pushEnabled } from '../config.js';
import { sendPushToUser } from '../lib/push.js';

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1024),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

export async function registerPushRoutes(app: FastifyInstance) {
  /** Public key + whether push is available at all — the frontend needs both before subscribing. */
  app.get('/push/vapid-public-key', async () => ({
    data: { key: config.vapidPublicKey || null, enabled: pushEnabled() },
  }));

  /** Upsert this browser's subscription. Idempotent: called on every app boot with permission granted. */
  app.post('/push/subscriptions', async (req, reply) => {
    const userId = requireUser(req);
    const body = subscriptionSchema.parse(req.body);

    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null,
      },
      // Re-subscribing on the same browser rotates the keys and, if the row was
      // left behind by a previous teacher on a shared device, reassigns it.
      update: {
        userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null,
      },
    });

    return reply.status(201).send({ data: { ok: true } });
  });

  /** Drop a subscription (permission revoked, or "disable push" in settings). */
  app.delete('/push/subscriptions', async (req, reply) => {
    const userId = requireUser(req);
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body ?? {});
    await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return reply.status(204).send();
  });

  /** Fire a test notification to the caller's devices, so the user can confirm it works. */
  app.post('/push/test', async (req) => {
    const userId = requireUser(req);
    const delivered = await sendPushToUser(userId, {
      title: '推送测试',
      body: '如果你看到这条通知，说明推送提醒已配置成功。',
      tag: 'test',
      url: '/schedule',
    });
    return { data: { delivered } };
  });
}
