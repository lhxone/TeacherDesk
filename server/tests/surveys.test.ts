import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { createTestApp, prisma, registerUser, resetDb, type TestUser } from './helpers.js';

type Field = {
  id: string;
  type: 'text' | 'textarea' | 'phone' | 'idcard' | 'number' | 'date' | 'select' | 'file';
  label: string;
  required: boolean;
  options?: string[];
};
type Survey = {
  id: string;
  title: string;
  description: string;
  publicToken: string;
  version: number;
  status: string;
  fields: Field[];
};
type Attachment = { fieldId: string; filename?: string; content?: Buffer };

const nameField: Field = { id: 'name', type: 'text', label: '姓名', required: true };
const fileField: Field = { id: 'document', type: 'file', label: '证明材料', required: false };
let app: FastifyInstance;
let owner: TestUser;
let storageRoot: string;
const originalStorageRoot = config.resourceStorageRoot;

beforeAll(async () => {
  // Public uploads in these tests must never touch the developer's resources.
  storageRoot = await mkdtemp(path.join(tmpdir(), 'teacherdesk-surveys-test-'));
  config.resourceStorageRoot = storageRoot;
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  config.resourceStorageRoot = originalStorageRoot;
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  owner = await registerUser(app);
});

async function createSurvey(fields: Field[] = [nameField], publish = true): Promise<Survey> {
  const created = await app.inject({
    method: 'POST', url: '/api/v1/surveys', headers: owner.auth,
    payload: { title: '学生信息收集', description: '请填写学生信息', fields },
  });
  expect(created.statusCode, created.body).toBe(201);
  const survey = created.json().data as Survey;
  if (!publish) return survey;
  const published = await updateSurvey(survey, { status: 'published' });
  expect(published.statusCode, published.body).toBe(200);
  return published.json().data as Survey;
}

function updateSurvey(survey: Survey, updates: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH', url: `/api/v1/surveys/${survey.id}`, headers: owner.auth,
    payload: { version: survey.version, ...updates },
  });
}

function multipartSubmission(version: number, answers: unknown, files: Attachment[] = []) {
  const boundary = '----teacherdesk-survey-test';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries({ version: String(version), answers: JSON.stringify(answers) })) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file:${file.fieldId}"; filename="${file.filename ?? 'note.txt'}"\r\n` +
      'Content-Type: text/plain\r\n\r\n',
    ));
    parts.push(file.content ?? Buffer.from('材料内容'));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  };
}

function submit(survey: Survey, answers: unknown, files: Attachment[] = [], headers: Record<string, string> = {}) {
  const multipart = multipartSubmission(survey.version, answers, files);
  return app.inject({
    method: 'POST', url: `/api/v1/public/surveys/${survey.publicToken}/responses`,
    payload: multipart.payload, headers: { ...multipart.headers, ...headers },
  });
}

function responses(survey: Survey, query = '') {
  return app.inject({
    method: 'GET', url: `/api/v1/surveys/${survey.id}/responses${query}`, headers: owner.auth,
  });
}

async function storedFiles(dir = storageRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    return entry.isDirectory() ? storedFiles(entryPath) : [entryPath];
  }));
  return files.flat().sort();
}

describe('survey collection: anonymous access and lifecycle', () => {
  it('publishes a custom survey, accepts anonymous answers and counts responses', async () => {
    const fields: Field[] = [
      nameField,
      { id: 'phone', type: 'phone', label: '电话', required: true },
      { id: 'identity', type: 'idcard', label: '身份证', required: true },
      { id: 'grade', type: 'select', label: '年级', required: true, options: ['七年级', '八年级'] },
      { id: 'birthday', type: 'date', label: '生日', required: false },
      { id: 'height', type: 'number', label: '身高', required: false },
      { id: 'notes', type: 'textarea', label: '备注', required: false },
    ];
    const survey = await createSurvey(fields);
    const publicForm = await app.inject({ method: 'GET', url: `/api/v1/public/surveys/${survey.publicToken}` });
    expect(publicForm.statusCode).toBe(200);
    expect(publicForm.headers['cache-control']).toContain('no-store');
    expect(publicForm.json().data).toEqual({
      title: survey.title, description: survey.description, version: survey.version, fields,
    });

    const answers = {
      name: '张三', phone: '13800138000', identity: '11010519491231002X', grade: '七年级',
      birthday: '2013-02-28', height: '160.5', notes: '放学后联系',
    };
    const submitted = await submit(survey, answers);
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect(Object.keys(submitted.json().data)).toEqual(['id']);
    const collected = await responses(survey);
    expect(collected.json().data).toHaveLength(1);
    expect(collected.json().data[0]).toMatchObject({
      id: submitted.json().data.id, answers, fields, files: [], createdAt: expect.any(String),
    });
    expect(collected.json().meta).toEqual({ total: 1, page: 1, pageSize: 20 });
    const listed = await app.inject({ method: 'GET', url: '/api/v1/surveys', headers: owner.auth });
    expect(listed.json().data).toEqual([expect.objectContaining({ id: survey.id, responseCount: 1 })]);
  });

  it('does not let an expired or malformed login token block a public form', async () => {
    const survey = await createSurvey();
    const headers = { authorization: 'Bearer expired.invalid.token' };
    const form = await app.inject({ method: 'GET', url: `/api/v1/public/surveys/${survey.publicToken}`, headers });
    expect(form.statusCode).toBe(200);
    const submitted = await submit(survey, { name: '访客' }, [], headers);
    expect(submitted.statusCode, submitted.body).toBe(201);
  });

  it.each(['draft', 'closed', 'deleted'] as const)('rejects reads and submissions for a %s survey', async (state) => {
    let survey = await createSurvey([nameField], state !== 'draft');
    if (state === 'closed') {
      const closed = await updateSurvey(survey, { status: 'closed' });
      expect(closed.statusCode).toBe(200);
      survey = closed.json().data;
    }
    if (state === 'deleted') {
      const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/surveys/${survey.id}`, headers: owner.auth });
      expect(deleted.statusCode).toBe(204);
      const listed = await app.inject({ method: 'GET', url: '/api/v1/surveys', headers: owner.auth });
      expect(listed.json().data).toEqual([]);
    }
    const form = await app.inject({ method: 'GET', url: `/api/v1/public/surveys/${survey.publicToken}` });
    expect(form.statusCode).toBe(404);
    const submitted = await submit(survey, { name: '访客' });
    expect(submitted.statusCode).toBe(404);
  });

  it('preserves earlier answers and field labels after the teacher edits a published survey', async () => {
    const survey = await createSurvey();
    expect((await submit(survey, { name: '张三' })).statusCode).toBe(201);
    const replacement: Field = { id: 'grade', type: 'text', label: '现在的年级', required: true };
    const changed = await updateSurvey(survey, { title: '更新后的调查', fields: [replacement] });
    expect(changed.statusCode, changed.body).toBe(200);
    const current = changed.json().data as Survey;
    expect(current.version).toBeGreaterThan(survey.version);
    expect((await submit(current, { grade: '八年级' })).statusCode).toBe(201);
    const collected = await responses(current);
    expect(collected.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: [nameField], answers: { name: '张三' } }),
      expect.objectContaining({ fields: [replacement], answers: { grade: '八年级' } }),
    ]));
  });

  it('rejects stale editor saves and stale public submissions without changing stored data', async () => {
    const survey = await createSurvey();
    const edited = await updateSurvey(survey, { title: '新标题' });
    expect(edited.statusCode).toBe(200);
    const staleSave = await updateSurvey(survey, { title: '旧窗口标题' });
    expect(staleSave.statusCode).toBe(409);
    const staleResponse = await submit(survey, { name: '旧页面' });
    expect(staleResponse.statusCode).toBe(409);
    expect((await responses(survey)).json().meta.total).toBe(0);
    const detail = await app.inject({ method: 'GET', url: `/api/v1/surveys/${survey.id}`, headers: owner.auth });
    expect(detail.json().data.title).toBe('新标题');
  });

  it('paginates collected responses without dropping or duplicating entries', async () => {
    const survey = await createSurvey();
    for (const name of ['甲', '乙', '丙']) expect((await submit(survey, { name })).statusCode).toBe(201);
    const first = (await responses(survey, '?page=1&pageSize=2')).json();
    const second = (await responses(survey, '?page=2&pageSize=2')).json();
    expect(first.meta).toEqual({ total: 3, page: 1, pageSize: 2 });
    expect(second.meta).toEqual({ total: 3, page: 2, pageSize: 2 });
    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    expect(new Set([...first.data, ...second.data].map((row: { id: string }) => row.id)).size).toBe(3);
  });
});

describe('survey collection: teacher isolation and files', () => {
  it('requires login and isolates management and collected answers by teacher', async () => {
    const survey = await createSurvey();
    const stranger = await registerUser(app);
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/surveys' });
    expect(unauthenticated.statusCode).toBe(401);
    const anonymousCreate = await app.inject({ method: 'POST', url: '/api/v1/surveys', payload: { title: '未登录' } });
    expect(anonymousCreate.statusCode).toBe(401);
    for (const suffix of ['', '/responses']) {
      expect((await app.inject({ method: 'GET', url: `/api/v1/surveys/${survey.id}${suffix}`, headers: stranger.auth })).statusCode).toBe(403);
    }
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/surveys/${survey.id}`, headers: stranger.auth,
      payload: { version: survey.version, title: '越权修改' },
    });
    expect(patch.statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/surveys/${survey.id}`, headers: stranger.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/surveys', headers: stranger.auth })).json().data).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/v1/surveys/${survey.id}`, headers: owner.auth })).json().data.title).toBe(survey.title);
  });

  it('accepts an anonymous attachment while only its survey owner can download it', async () => {
    const survey = await createSurvey([nameField, fileField]);
    const bytes = Buffer.from('需要保护的材料');
    const submitted = await submit(survey, { name: '张三' }, [{ fieldId: fileField.id, filename: 'proof.txt', content: bytes }]);
    expect(submitted.statusCode, submitted.body).toBe(201);
    const collected = await responses(survey);
    const file = collected.json().data[0].files[0];
    expect(file).toMatchObject({ id: expect.any(String), fieldId: fileField.id, originalFilename: 'proof.txt', fileSize: bytes.length });
    expect(file).not.toHaveProperty('storagePath');
    expect(collected.body).not.toContain(storageRoot);
    expect(submitted.body).not.toContain('proof.txt');
    const url = `/api/v1/surveys/${survey.id}/files/${file.id}`;
    const download = await app.inject({ method: 'GET', url, headers: owner.auth });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(bytes);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    expect(download.headers['cache-control']).toContain('no-store');
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const stranger = await registerUser(app);
    expect((await app.inject({ method: 'GET', url, headers: stranger.auth })).statusCode).toBe(403);
    const secondSurvey = await createSurvey();
    expect((await app.inject({
      method: 'GET', url: `/api/v1/surveys/${secondSurvey.id}/files/${file.id}`, headers: owner.auth,
    })).statusCode).toBe(403);
    const publicDownload = await app.inject({ method: 'GET', url: `/api/v1/public/surveys/${survey.publicToken}/files/${file.id}` });
    expect([401, 404]).toContain(publicDownload.statusCode);
  });
});

describe('survey collection: input validation', () => {
  it('handles prototype-named field IDs and rejects hidden prototype keys in answers', async () => {
    const survey = await createSurvey([{ id: 'toString', type: 'text', label: '选填备注', required: false }]);
    const submitted = await submit(survey, {});
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect((await responses(survey)).json().data[0].answers).toEqual({ toString: '' });
    const malicious = await submit(survey, JSON.parse('{"__proto__":"injected"}'));
    expect(malicious.statusCode, malicious.body).toBe(400);
    expect((await responses(survey)).json().meta.total).toBe(1);
  });

  it('rejects malformed multipart boundaries with a validation error', async () => {
    const survey = await createSurvey();
    const submitted = await app.inject({
      method: 'POST', url: `/api/v1/public/surveys/${survey.publicToken}/responses`,
      headers: { 'content-type': 'multipart/form-data' }, payload: 'missing-boundary',
    });
    expect(submitted.statusCode, submitted.body).toBe(400);
    expect((await responses(survey)).json().meta.total).toBe(0);
  });

  it.each([
    ['required text', nameField, '  '],
    ['phone', { id: 'phone', type: 'phone', label: '电话', required: true }, 'not-a-phone'],
    ['identity checksum', { id: 'identity', type: 'idcard', label: '身份证', required: true }, '110105194912310021'],
    ['calendar date', { id: 'birthday', type: 'date', label: '生日', required: true }, '2026-02-30'],
    ['finite number', { id: 'height', type: 'number', label: '身高', required: true }, 'Infinity'],
    ['select option', { id: 'grade', type: 'select', label: '年级', required: true, options: ['七年级'] }, '未知年级'],
  ] as [string, Field, string][])('rejects an invalid %s answer and saves no response', async (_label, field, value) => {
    const survey = await createSurvey([field]);
    const submitted = await submit(survey, { [field.id]: value });
    expect(submitted.statusCode, submitted.body).toBe(400);
    expect((await responses(survey)).json().meta.total).toBe(0);
  });

  it('rejects missing required fields, unknown answers and incorrectly typed answer values', async () => {
    const survey = await createSurvey();
    for (const answers of [{}, { name: '张三', hidden: '注入字段' }, { name: { nested: '不合法' } }]) {
      const submitted = await submit(survey, answers);
      expect(submitted.statusCode, submitted.body).toBe(400);
    }
    expect((await responses(survey)).json().meta.total).toBe(0);
  });

  it('requires a real upload for a required file field', async () => {
    const survey = await createSurvey([{ ...fileField, required: true }]);
    expect((await submit(survey, {})).statusCode).toBe(400);
    expect((await submit(survey, { document: 'fake-path.pdf' })).statusCode).toBe(400);
    expect((await submit(survey, {}, [{ fieldId: fileField.id }])).statusCode).toBe(201);
  });

  it('rejects unknown or duplicate file fields and leaves no saved files or responses', async () => {
    const survey = await createSurvey([nameField, fileField]);
    const before = await storedFiles();
    for (const files of [
      [{ fieldId: 'unknown' }],
      [{ fieldId: 'name' }],
      [{ fieldId: fileField.id }, { fieldId: fileField.id }],
    ]) {
      const submitted = await submit(survey, { name: '张三' }, files);
      expect(submitted.statusCode, submitted.body).toBe(400);
      expect(await storedFiles()).toEqual(before);
    }
    expect((await responses(survey)).json().meta.total).toBe(0);
  });

  it('rejects a file over 10 MiB and does not leave a partial response or file', async () => {
    const survey = await createSurvey([fileField]);
    const before = await storedFiles();
    const submitted = await submit(survey, {}, [{ fieldId: fileField.id, content: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
    expect(submitted.statusCode, submitted.body).toBe(413);
    expect((await responses(survey)).json().meta.total).toBe(0);
    expect(await storedFiles()).toEqual(before);
  });

  it('refuses malformed field definitions and publishing an empty draft', async () => {
    const empty = await createSurvey([], false);
    expect((await updateSurvey(empty, { status: 'published' })).statusCode).toBe(400);
    for (const fields of [
      [nameField, { ...nameField, label: '重复字段' }],
      [{ id: 'grade', type: 'select', label: '年级', required: true, options: [] }],
      [{ id: 'grade', type: 'select', label: '年级', required: true, options: ['七年级', '七年级'] }],
      [{ id: 'bad', type: 'script', label: '未知类型', required: false }],
    ]) {
      const created = await app.inject({ method: 'POST', url: '/api/v1/surveys', headers: owner.auth, payload: { title: '无效调查', fields } });
      expect(created.statusCode, created.body).toBe(400);
    }
  });
});

describe('survey collection: concurrent publication changes', () => {
  it.each(['close', 'edit', 'delete', 'owner-delete'] as const)(
    'rechecks a survey after upload when a concurrent %s finishes first', async (change) => {
      const survey = await createSurvey([nameField, fileField]);
      const before = await storedFiles();
      let signalUpload!: () => void;
      let resumeUpload!: () => void;
      const uploadStarted = new Promise<void>((resolve) => { signalUpload = resolve; });
      const uploadPaused = new Promise<void>((resolve) => { resumeUpload = resolve; });
      const originalWrite = fs.writeFile.bind(fs);
      const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
        await originalWrite(...args);
        signalUpload();
        await uploadPaused;
      });
      let pendingSubmission: ReturnType<typeof submit> | undefined;
      try {
        // app.inject executes eagerly. Holding the disk write models a slow
        // upload without holding a DB transaction or relying on timer races.
        pendingSubmission = submit(survey, { name: '上传中的访客' }, [{ fieldId: fileField.id }]);
        await uploadStarted;
        if (change === 'delete') {
          expect((await app.inject({ method: 'DELETE', url: `/api/v1/surveys/${survey.id}`, headers: owner.auth })).statusCode).toBe(204);
        } else if (change === 'owner-delete') {
          await prisma.user.update({ where: { id: owner.id }, data: { deletedAt: new Date() } });
        } else {
          const changed = await updateSurvey(survey, change === 'close' ? { status: 'closed' } : { title: '调查已更新' });
          expect(changed.statusCode, changed.body).toBe(200);
        }
        resumeUpload();
        const submitted = await pendingSubmission;
        expect(submitted.statusCode, submitted.body).toBe(change === 'edit' ? 409 : 404);
        expect(await prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(0);
        expect(await storedFiles()).toEqual(before);
      } finally {
        resumeUpload();
        await pendingSubmission;
        writeSpy.mockRestore();
      }
    },
  );
});
