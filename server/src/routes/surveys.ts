import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../app.js';
import { ApiError } from '../errors.js';
import { absoluteResourcePath, deleteResourceFile, readResourceFile } from '../lib/resourceStorage.js';
import {
  createSurveySchema, updateSurveySchema, requireSurvey, requirePublicSurvey,
  serializeSurvey, surveyInclude, lockSurvey, validateSurveyAnswers,
  SURVEY_FILE_LIMIT, SURVEY_TOTAL_FILE_LIMIT, type SurveyField,
} from '../lib/surveys.js';

const idParams = z.object({ id: z.string().uuid() });
// Tokens are random 192-bit URL-safe strings. Invalid/unknown tokens reveal the same error.
function publicToken(req: FastifyRequest): string {
  const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).safeParse(req.params);
  if (!parsed.success) throw ApiError.notFound('调查不存在或已停止收集');
  return parsed.data.token;
}

type UploadedFile = { id: string; fieldId: string; originalFilename: string; fileSize: number; storagePath: string };

function safeFilename(filename: string) {
  return filename.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255).trim() || '附件';
}

export async function registerSurveyRoutes(app: FastifyInstance) {
  app.get('/surveys', async (req) => {
    const userId = requireUser(req);
    const rows = await prisma.survey.findMany({
      where: { userId, deletedAt: null, user: { deletedAt: null } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: surveyInclude,
    });
    return { data: rows.map(serializeSurvey) };
  });

  app.post('/surveys', async (req, reply) => {
    const userId = requireUser(req);
    const body = createSurveySchema.parse(req.body);
    const owner = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
    if (!owner) throw ApiError.unauthenticated();
    const survey = await prisma.survey.create({
      data: { ...body, userId, publicToken: randomBytes(24).toString('base64url') },
      include: surveyInclude,
    });
    return reply.status(201).send({ data: serializeSurvey(survey) });
  });

  app.get('/surveys/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return { data: serializeSurvey(await requireSurvey(id, requireUser(req))) };
  });

  app.patch('/surveys/:id', async (req) => {
    const userId = requireUser(req);
    const { id } = idParams.parse(req.params);
    const body = updateSurveySchema.parse(req.body);
    const survey = await prisma.$transaction(async (tx) => {
      await lockSurvey(tx, id);
      const current = await requireSurvey(id, userId, tx);
      if (body.version !== current.version) throw ApiError.conflict('调查已更新，请刷新后重试');
      const fields = body.fields ?? current.fields as SurveyField[];
      if ((body.status ?? current.status) === 'published' && fields.length === 0) {
        throw ApiError.validation('请至少添加一个字段后再发布');
      }
      return tx.survey.update({
        where: { id },
        data: { title: body.title, description: body.description, fields: body.fields, status: body.status, version: { increment: 1 } },
        include: surveyInclude,
      });
    });
    return { data: serializeSurvey(survey) };
  });

  app.delete('/surveys/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const userId = requireUser(req);
    await prisma.$transaction(async (tx) => {
      await lockSurvey(tx, id);
      await requireSurvey(id, userId, tx);
      await tx.survey.update({ where: { id }, data: { deletedAt: new Date(), status: 'closed', version: { increment: 1 } } });
    });
    return reply.status(204).send();
  });

  app.get('/surveys/:id/responses', async (req) => {
    const { id } = idParams.parse(req.params);
    await requireSurvey(id, requireUser(req));
    const { page, pageSize } = z.object({
      page: z.coerce.number().int().min(1).max(1000000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(req.query);
    const [rows, total] = await prisma.$transaction([
      prisma.surveyResponse.findMany({
        where: { surveyId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, createdAt: true, fields: true, answers: true,
          files: { select: { id: true, fieldId: true, originalFilename: true, fileSize: true }, orderBy: { createdAt: 'asc' } },
        },
      }),
      prisma.surveyResponse.count({ where: { surveyId: id } }),
    ]);
    return { data: rows, meta: { total, page, pageSize } };
  });

  app.get('/surveys/:id/files/:fileId', async (req, reply) => {
    const { id, fileId } = z.object({ id: z.string().uuid(), fileId: z.string().uuid() }).parse(req.params);
    await requireSurvey(id, requireUser(req));
    const file = await prisma.surveyFile.findFirst({ where: { id: fileId, response: { surveyId: id } } });
    if (!file) throw ApiError.forbidden();
    let bytes: Buffer;
    try {
      bytes = await readResourceFile(file.storagePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw ApiError.notFound('附件不存在');
      throw error;
    }
    return reply.header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.originalFilename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`)
      .header('X-Content-Type-Options', 'nosniff').send(bytes);
  });

  app.get('/public/surveys/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const survey = await requirePublicSurvey(publicToken(req));
    return { data: { title: survey.title, description: survey.description, version: survey.version, fields: survey.fields } };
  });

  app.post('/public/surveys/:token/responses', {
    // A whole class may submit from the school's shared public IP at once.
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const token = publicToken(req);
    const survey = await requirePublicSurvey(token);
    if (!req.isMultipart()) throw ApiError.validation('请使用表单格式提交');
    const fields = survey.fields as SurveyField[];
    const allowedFiles = new Set(fields.filter((field) => field.type === 'file').map((field) => field.id));
    const uploaded: UploadedFile[] = [];
    const writtenPaths: string[] = [];
    const fileFieldIds = new Set<string>();
    const textParts = new Map<string, string>();
    let totalBytes = 0;
    try {
      for await (const part of req.parts({ limits: {
        // JSON escaping can take six bytes per character; this bounded field
        // allowance covers 50 textarea answers of 10,000 characters each.
        fileSize: SURVEY_FILE_LIMIT, files: 5, fields: 2, parts: 7, fieldSize: 4 * 1024 * 1024, fieldNameSize: 100,
      } })) {
        if (part.type === 'field') {
          if (!['version', 'answers'].includes(part.fieldname) || textParts.has(part.fieldname)
            || part.fieldnameTruncated || part.valueTruncated || typeof part.value !== 'string') {
            throw ApiError.validation('表单包含重复、未知或过长的字段');
          }
          textParts.set(part.fieldname, part.value);
          continue;
        }
        const fieldId = part.fieldname.startsWith('file:') ? part.fieldname.slice(5) : '';
        if (!allowedFiles.has(fieldId) || fileFieldIds.has(fieldId)) {
          part.file.resume();
          throw ApiError.validation('附件字段无效或重复');
        }
        fileFieldIds.add(fieldId);
        const buffer = await part.toBuffer();
        if (part.file.truncated) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '每个文件最大支持 10MB');
        if (!buffer.length) throw ApiError.validation('不能上传空文件');
        totalBytes += buffer.length;
        if (totalBytes > SURVEY_TOTAL_FILE_LIMIT) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '附件总大小不能超过 50MB');
        const fileId = randomUUID();
        const storagePath = path.join('surveys', survey.userId, survey.id, fileId);
        const absolutePath = absoluteResourcePath(storagePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        writtenPaths.push(storagePath);
        await fs.writeFile(absolutePath, buffer, { flag: 'wx' });
        uploaded.push({ id: fileId, fieldId, originalFilename: safeFilename(part.filename), fileSize: buffer.length, storagePath });
      }
      const rawVersion = textParts.get('version');
      if (!rawVersion || !/^[1-9]\d{0,9}$/.test(rawVersion)) throw ApiError.validation('调查版本无效');
      const version = Number(rawVersion);
      let rawAnswers: unknown;
      try {
        rawAnswers = JSON.parse(textParts.get('answers') ?? '');
      } catch {
        throw ApiError.validation('答案格式无效');
      }
      const response = await prisma.$transaction(async (tx) => {
        // Slow uploads must not hold DB locks. Lock and re-read the current
        // survey only now, preventing an edit/close/delete during validation.
        await lockSurvey(tx, survey.id);
        const current = await requirePublicSurvey(token, tx);
        if (current.version !== version) throw ApiError.conflict('调查已更新，请刷新后重新填写');
        const currentFields = current.fields as SurveyField[];
        const answers = validateSurveyAnswers(currentFields, rawAnswers, fileFieldIds);
        return tx.surveyResponse.create({
          data: { surveyId: current.id, version, fields: currentFields, answers, files: { create: uploaded } },
          select: { id: true },
        });
      });
      return reply.status(201).send({ data: response });
    } catch (error) {
      const cleanup = await Promise.allSettled(writtenPaths.map(deleteResourceFile));
      cleanup.forEach((result) => {
        if (result.status === 'rejected') req.log.error({ err: result.reason }, 'failed to remove rejected survey attachment');
      });
      const code = (error as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE') throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '每个文件最大支持 10MB');
      if (code === 'FST_PROTO_VIOLATION' || code === 'FST_INVALID_JSON_FIELD_ERROR') {
        throw ApiError.validation('表单字段格式无效');
      }
      if (code?.startsWith('FST_') && (code.includes('LIMIT') || code.includes('MULTIPART') || code.includes('FILES') || code.includes('FIELDS') || code.includes('PARTS'))) {
        throw ApiError.validation('上传的文件或表单字段超出限制');
      }
      if (error instanceof Error && /Unexpected end of (form|file|multipart)|Malformed part header|Multipart:|Part terminated early/.test(error.message)) {
        throw ApiError.validation('上传的表单不完整，请重新提交');
      }
      throw error;
    }
  });
}
