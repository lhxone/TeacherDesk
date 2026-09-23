import type { Prisma, Survey } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';

export const SURVEY_FILE_LIMIT = 10 * 1024 * 1024;
export const SURVEY_TOTAL_FILE_LIMIT = 5 * SURVEY_FILE_LIMIT;
export const SURVEY_FIELD_TYPES = ['text', 'textarea', 'phone', 'idcard', 'number', 'date', 'select', 'file'] as const;

const fieldSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, '字段标识格式不正确')
    .refine((id) => !['__proto__', 'constructor', 'prototype'].includes(id), '字段标识不可使用此名称'),
  type: z.enum(SURVEY_FIELD_TYPES),
  label: z.string().trim().min(1, '请输入字段名称').max(100),
  required: z.boolean(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
}).strict().superRefine((field, ctx) => {
  if (field.type === 'select' && !field.options?.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '单选字段至少需要一个选项' });
  }
  if (field.options && new Set(field.options).size !== field.options.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '选项不能重复' });
  }
});

export const surveyFieldsSchema = z.array(fieldSchema).max(50, '每个调查最多添加 50 个字段')
  .superRefine((fields, ctx) => {
    if (new Set(fields.map((field) => field.id)).size !== fields.length) {
      ctx.addIssue({ code: 'custom', message: '字段标识不能重复' });
    }
    if (fields.filter((field) => field.type === 'file').length > 5) {
      ctx.addIssue({ code: 'custom', message: '每个调查最多添加 5 个文件字段' });
    }
  });

export type SurveyField = z.infer<typeof fieldSchema>;

export const createSurveySchema = z.object({
  title: z.string().trim().min(1, '请输入调查标题').max(120),
  description: z.string().max(5000).optional().default(''),
  fields: surveyFieldsSchema,
}).strict();

export const updateSurveySchema = z.object({
  title: z.string().trim().min(1, '请输入调查标题').max(120).optional(),
  description: z.string().max(5000).optional(),
  fields: surveyFieldsSchema.optional(),
  status: z.enum(['draft', 'published', 'closed']).optional(),
  version: z.number().int().positive(),
}).strict();

export const surveyInclude = { _count: { select: { responses: true } } } as const;

export function serializeSurvey(survey: Survey & { _count: { responses: number } }) {
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    status: survey.status,
    publicToken: survey.publicToken,
    version: survey.version,
    fields: survey.fields,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    responseCount: survey._count.responses,
  };
}

type SurveyDb = Pick<Prisma.TransactionClient, 'survey'>;

export async function requireSurvey(id: string, userId: string, db: SurveyDb = prisma) {
  const survey = await db.survey.findFirst({
    where: { id, userId, deletedAt: null, user: { deletedAt: null } },
    include: surveyInclude,
  });
  if (!survey) throw ApiError.forbidden();
  return survey;
}

export async function requirePublicSurvey(publicToken: string, db: SurveyDb = prisma) {
  const survey = await db.survey.findFirst({
    where: { publicToken, status: 'published', deletedAt: null, user: { deletedAt: null } },
  });
  if (!survey) throw ApiError.notFound('调查不存在或已停止收集');
  return survey;
}

/** Serialize edit/close/delete with final submission checks, after receiving files. */
export async function lockSurvey(tx: Prisma.TransactionClient, id: string) {
  // Lock owner availability too: a concurrent soft-delete of the account must
  // serialize with a submission, just like changing the survey's status.
  await tx.$queryRaw`SELECT s.id FROM surveys s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${id}::uuid FOR UPDATE OF s FOR SHARE OF u`;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validIdCard(value: string): boolean {
  if (/^[1-9]\d{14}$/.test(value)) {
    return isDate(`19${value.slice(6, 8)}-${value.slice(8, 10)}-${value.slice(10, 12)}`);
  }
  if (!/^[1-9]\d{16}[\dXx]$/.test(value)) return false;
  if (!isDate(`${value.slice(6, 10)}-${value.slice(10, 12)}-${value.slice(12, 14)}`)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  return '10X98765432'[sum % 11] === value[17].toUpperCase();
}

/** Validate against a server snapshot, never trust fields/options supplied by a respondent. */
export function validateSurveyAnswers(fields: SurveyField[], input: unknown, fileFieldIds: Set<string>) {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  // Inspect original keys before Zod copies the record: it deliberately skips
  // __proto__, which must still be rejected as an unknown answer here.
  for (const key of Object.keys(input && typeof input === 'object' ? input : {})) {
    const field = fieldMap.get(key);
    if (!field || field.type === 'file') throw ApiError.validation('答案包含未知字段或文件字段');
  }
  const parsed = z.record(z.string().max(10000)).parse(input);
  for (const key of fileFieldIds) {
    if (fieldMap.get(key)?.type !== 'file') throw ApiError.validation('附件包含未知字段');
  }

  const answers: Record<string, string> = Object.create(null);
  for (const field of fields) {
    if (field.type === 'file') {
      if (field.required && !fileFieldIds.has(field.id)) {
        throw ApiError.validation(`请上传「${field.label}」`, [{ field: field.id, message: '请上传文件' }]);
      }
      continue;
    }
    const value = (Object.hasOwn(parsed, field.id) ? parsed[field.id] : '').trim();
    const fail = (message: string): never => {
      throw ApiError.validation(`「${field.label}」${message}`, [{ field: field.id, message }]);
    };
    if (field.required && !value) fail('为必填项');
    if (value.length > (field.type === 'textarea' ? 10000 : 2000)) fail('内容过长');
    if (value) {
      if (field.type === 'phone' && (!/^\+?[\d\s()-]+$/.test(value) || !/^\d{7,20}$/.test(value.replace(/\D/g, '')))) {
        fail('请输入有效电话号码');
      }
      if (field.type === 'idcard' && !validIdCard(value)) fail('请输入有效身份证号码');
      if (field.type === 'date' && !isDate(value)) fail('请输入有效日期');
      if (field.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
        fail('请输入有效数字');
      }
      if (field.type === 'select' && !field.options?.includes(value)) fail('请选择有效选项');
    }
    answers[field.id] = field.type === 'idcard' ? value.toUpperCase() : value;
  }
  return answers;
}
