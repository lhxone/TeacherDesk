import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { verifyAccessToken } from './lib/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClassRoutes } from './routes/classes.js';
import { registerStudentRoutes } from './routes/students.js';
import { registerTagRoutes } from './routes/tags.js';
import { registerScheduleRoutes } from './routes/schedule.js';
import { registerEventRoutes } from './routes/events.js';
import { registerSeatingRoutes } from './routes/seating.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerExamRoutes } from './routes/exams.js';
import { registerScoreRoutes } from './routes/scores.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerExportRoutes } from './routes/exports.js';
import { registerPushRoutes } from './routes/push.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerWeatherRoutes } from './routes/weather.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/** Routes reachable without a bearer token. */
const PUBLIC_ROUTES = new Set([
  'POST:/api/v1/auth/register',
  'POST:/api/v1/auth/login',
  'POST:/api/v1/auth/refresh',
  'GET:/api/v1/health',
]);

export function requireUser(req: FastifyRequest): string {
  if (!req.userId) throw ApiError.unauthenticated();
  return req.userId;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest ? false : { level: 'info' },
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  // Authentication: populate req.userId, reject protected routes without a token.
  app.addHook('onRequest', async (req) => {
    const key = `${req.method}:${req.routeOptions?.url ?? req.url.split('?')[0]}`;
    const header = req.headers.authorization;

    if (header?.startsWith('Bearer ')) {
      const payload = verifyAccessToken(header.slice(7));
      req.userId = payload.sub;
    }

    if (PUBLIC_ROUTES.has(key)) return;
    if (!req.url.startsWith('/api/v1')) return;
    if (!req.userId) throw ApiError.unauthenticated();
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;

    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details, requestId },
      });
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数校验失败',
          details: err.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
          requestId,
        },
      });
    }

    // Prisma unique-constraint violation.
    if ((err as { code?: string }).code === 'P2002') {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: '数据已存在，违反唯一性约束', requestId },
      });
    }

    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试', requestId },
      });
    }

    req.log?.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误', requestId },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: '接口不存在', requestId: req.id },
    });
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    version: '1.0.0',
    time: new Date().toISOString(),
  }));

  const prefix = '/api/v1';
  await app.register(registerAuthRoutes, { prefix });
  await app.register(registerClassRoutes, { prefix });
  await app.register(registerStudentRoutes, { prefix });
  await app.register(registerTagRoutes, { prefix });
  await app.register(registerScheduleRoutes, { prefix });
  await app.register(registerEventRoutes, { prefix });
  await app.register(registerSeatingRoutes, { prefix });
  await app.register(registerToolRoutes, { prefix });
  await app.register(registerExamRoutes, { prefix });
  await app.register(registerScoreRoutes, { prefix });
  await app.register(registerAnalyticsRoutes, { prefix });
  await app.register(registerExportRoutes, { prefix });
  await app.register(registerPushRoutes, { prefix });
  await app.register(registerDeviceRoutes, { prefix });
  await app.register(registerWeatherRoutes, { prefix });

  return app;
}
