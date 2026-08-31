import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config, DEFAULT_SETTINGS } from '../config.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { describeUserAgent } from '../lib/device.js';
import { normalizeDaySchedule } from '../lib/daySchedule.js';
import { isValidTimeZone } from '../lib/timezone.js';
import {
  assertNotLocked,
  clearLoginFailures,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  recordLoginFailure,
  refreshTokenExpiry,
  signAccessToken,
  validatePasswordStrength,
  verifyPassword,
} from '../lib/auth.js';

const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确').max(255),
  password: z.string(),
  displayName: z.string().min(1, '昵称不能为空').max(64),
});

const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string(),
  rememberMe: z.boolean().optional().default(false),
});

function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  settings: unknown;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    settings: { ...DEFAULT_SETTINGS, ...(u.settings as object) },
    createdAt: u.createdAt.toISOString(),
  };
}

async function issueTokens(userId: string, email: string, rememberMe: boolean, device?: string) {
  const accessToken = signAccessToken({ sub: userId, email });
  const { token, hash } = generateRefreshToken();

  const row = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash,
      deviceInfo: describeUserAgent(device).slice(0, 255),
      expiresAt: refreshTokenExpiry(rememberMe),
    },
  });

  return {
    accessToken,
    refreshToken: token,
    sessionId: row.id,
    expiresIn: config.accessTokenTtlSec,
  };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    validatePasswordStrength(body.password);

    const existing = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) throw ApiError.conflict('该邮箱已注册');

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName.trim(),
        settings: DEFAULT_SETTINGS,
      },
    });

    const tokens = await issueTokens(user.id, user.email, false, req.headers['user-agent']);
    return reply.status(201).send({ data: { user: publicUser(user), ...tokens } });
  });

  app.post('/auth/login', async (req) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();
    const throttleKey = `${email}|${req.ip}`;

    assertNotLocked(throttleKey);

    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });

    // Same message whether the email is unknown or the password is wrong,
    // so the endpoint cannot be used to enumerate registered accounts.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      recordLoginFailure(throttleKey);
      throw ApiError.unauthenticated('邮箱或密码错误');
    }

    clearLoginFailures(throttleKey);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const tokens = await issueTokens(
      user.id,
      user.email,
      body.rememberMe,
      req.headers['user-agent'],
    );
    return { data: { user: publicUser(user), ...tokens } };
  });

  app.post('/auth/refresh', async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const hash = hashRefreshToken(refreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!stored) throw ApiError.unauthenticated('刷新令牌无效');

    // Reuse of an already-rotated token means the token may be compromised:
    // revoke the whole family (API.md §1 /auth/refresh).
    if (stored.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw ApiError.unauthenticated('刷新令牌已失效，请重新登录');
    }

    if (stored.expiresAt < new Date()) {
      throw ApiError.unauthenticated('刷新令牌已过期，请重新登录');
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const remainingMs = stored.expiresAt.getTime() - Date.now();
    const rememberMe = remainingMs > config.refreshTokenTtlDays * 24 * 60 * 60 * 1000;

    const tokens = await issueTokens(
      stored.userId,
      stored.user.email,
      rememberMe,
      req.headers['user-agent'],
    );
    return { data: tokens };
  });

  app.post('/auth/logout', async (req, reply) => {
    const userId = requireUser(req);
    const body = z
      .object({ refreshToken: z.string().optional(), allDevices: z.boolean().optional() })
      .parse(req.body ?? {});

    if (body.allDevices) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else if (body.refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { userId, tokenHash: hashRefreshToken(body.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => {
    const userId = requireUser(req);
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw ApiError.unauthenticated();
    return { data: publicUser(user) };
  });

  app.patch('/auth/me', async (req) => {
    const userId = requireUser(req);
    const body = z
      .object({
        displayName: z.string().min(1).max(64).optional(),
        avatarUrl: z.string().url().max(512).nullable().optional(),
        settings: z
          .record(z.unknown())
          .refine(
            (s) =>
              s.remindBeforeMinutes === undefined ||
              (typeof s.remindBeforeMinutes === 'number' &&
                s.remindBeforeMinutes >= 1 &&
                s.remindBeforeMinutes <= 120),
            { message: 'remindBeforeMinutes 需在 1–120 之间' },
          )
          .refine(
            (s) =>
              s.timeZone === undefined || s.timeZone === null ||
              (typeof s.timeZone === 'string' && isValidTimeZone(s.timeZone)),
            { message: 'timeZone 不是有效的 IANA 时区名称' },
          )
          .optional(),
      })
      .parse(req.body);

    const current = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!current) throw ApiError.unauthenticated();

    // Normalise (validate + sort + renumber lesson periods) before persisting.
    const incomingSettings = body.settings ? { ...body.settings } : undefined;
    if (incomingSettings && 'daySchedule' in incomingSettings) {
      incomingSettings.daySchedule = normalizeDaySchedule(incomingSettings.daySchedule);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        displayName: body.displayName,
        avatarUrl: body.avatarUrl,
        settings: incomingSettings
          ? ({ ...(current.settings as object), ...incomingSettings } as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return { data: publicUser(user) };
  });

  app.post('/auth/change-password', async (req, reply) => {
    const userId = requireUser(req);
    const body = z
      .object({ currentPassword: z.string(), newPassword: z.string() })
      .parse(req.body);

    validatePasswordStrength(body.newPassword);

    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw ApiError.unauthenticated();

    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw ApiError.validation('当前密码不正确', [
        { field: 'currentPassword', message: '当前密码不正确' },
      ]);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(body.newPassword) },
      }),
      // PRD §3.1.4: changing the password signs out every other device.
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return reply.status(204).send();
  });
}
