import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
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
import { registerKnowledgeNodeRoutes } from './routes/knowledgeNodes.js';
import { registerResourceCollectionRoutes } from './routes/resourceCollections.js';
import { registerResourceRoutes } from './routes/resources.js';

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
    // api is never reached directly (docker-compose.yml keeps it off any
    // published port); the only caller is this deployment's own nginx, which
    // resolves Cloudflare's CF-Connecting-IP into the real client IP and
    // forwards it via X-Forwarded-For (web/nginx.conf). `true` here would be
    // wrong: @fastify/proxy-addr trusts every hop it's given and reads the
    // *left*-most (i.e. earliest, client-supplied) entry, so a caller could
    // put `X-Forwarded-For: 1.2.3.4` on their own request — nginx only
    // appends to that header, it doesn't replace it — and spoof req.ip,
    // defeating both the rate limiter below and the login lockout in
    // lib/auth.ts. 'uniquelocal' (RFC1918 + fc00::/7) makes proxy-addr trust
    // only the docker-internal hop (nginx) and stop there, using the IP
    // nginx itself recorded — the one no client request can override.
    trustProxy: 'uniquelocal',
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  // Excel template uploads (student roster / score import) only — capped well
  // above a realistic workbook so a bad file fails fast instead of ballooning memory.
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  // Global per-IP request cap as defence in depth on top of the dedicated
  // login lockout in lib/auth.ts (which stays in charge of the 5-failures /
  // 15-minute rule tested in auth.test.ts). This one just stops a single
  // client from hammering *any* endpoint — registration, refresh, exports,
  // the classroom tools — at high volume. Disabled under test: `app.inject()`
  // calls don't carry distinct sockets, so every request in a test file would
  // otherwise share one counter and trip the limit well before the 179 cases
  // that intentionally loop requests (e.g. the lockout test itself) finish.
  if (!config.isTest) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
      }),
    });
  }

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
  await app.register(registerKnowledgeNodeRoutes, { prefix });
  await app.register(registerResourceCollectionRoutes, { prefix });
  await app.register(registerResourceRoutes, { prefix });

  return app;
}
