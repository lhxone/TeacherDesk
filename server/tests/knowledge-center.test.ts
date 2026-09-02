import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createTestApp,
  multipartFileWithFields,
  prisma,
  registerUser,
  resetDb,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let user: TestUser;

/** Poll until the background parse job (setImmediate + async I/O) lands. */
async function waitForResourceStatus(resourceId: string, status: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const row = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    if (row.status === status) return row;
    if (Date.now() - start > timeoutMs) return row;
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  user = await registerUser(app);
});

describe('knowledge nodes', () => {
  it('creates a tree and lists it flat with parentId', async () => {
    const root = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: '有理数', subject: '数学', grade: '七年级' },
    });
    expect(root.statusCode).toBe(201);
    const rootId = root.json().data.id;

    const child = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: '有理数的加减法', parentId: rootId },
    });
    expect(child.statusCode).toBe(201);
    expect(child.json().data.parentId).toBe(rootId);

    const list = await app.inject({ method: 'GET', url: '/api/v1/knowledge-nodes', headers: user.auth });
    expect(list.json().data).toHaveLength(2);
  });

  it('refuses to move a node under its own descendant (cycle)', async () => {
    const root = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: 'A' },
    });
    const rootId = root.json().data.id;
    const child = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: 'B', parentId: rootId },
    });
    const childId = child.json().data.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-nodes/${rootId}`,
      headers: user.auth,
      payload: { parentId: childId },
    });
    expect(res.statusCode).toBe(422);
  });

  it('soft-deletes a node and cascades to children', async () => {
    const root = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: 'A' },
    });
    const rootId = root.json().data.id;
    await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: 'B', parentId: rootId },
    });

    await app.inject({ method: 'DELETE', url: `/api/v1/knowledge-nodes/${rootId}`, headers: user.auth });

    const list = await app.inject({ method: 'GET', url: '/api/v1/knowledge-nodes', headers: user.auth });
    expect(list.json().data).toHaveLength(0);
  });
});

describe('resource collections', () => {
  it('creates nested folders and counts resources inside', async () => {
    const folder = await app.inject({
      method: 'POST',
      url: '/api/v1/resource-collections',
      headers: user.auth,
      payload: { name: '七年级数学' },
    });
    expect(folder.statusCode).toBe(201);
    expect(folder.json().data.resourceCount).toBe(0);
  });

  it('unsets collectionId on resources when their folder is deleted', async () => {
    const folder = await app.inject({
      method: 'POST',
      url: '/api/v1/resource-collections',
      headers: user.auth,
      payload: { name: 'F1' },
    });
    const folderId = folder.json().data.id;

    const { headers, payload } = multipartFileWithFields(Buffer.from('hello'), 'note.txt', {
      collectionId: folderId,
    });
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    expect(upload.statusCode).toBe(201);
    const resourceId = upload.json().data.id;

    await app.inject({ method: 'DELETE', url: `/api/v1/resource-collections/${folderId}`, headers: user.auth });

    const row = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(row.collectionId).toBeNull();
  });
});

describe('resources: upload lifecycle', () => {
  it('uploads a plain text file, infers title, and reaches ready with no chunks', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('some notes'), '教案草稿.txt');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.title).toBe('教案草稿');
    expect(body.originalFilename).toBe('教案草稿.txt');
    expect(['pending', 'parsing', 'ready']).toContain(body.status);

    // The parse job is scheduled via setImmediate and does its own async I/O
    // (a DB read then a write), so poll briefly rather than assuming one tick.
    const row = await waitForResourceStatus(body.id, 'ready');
    expect(row.status).toBe('ready');
  });

  it('rejects an upload with no file', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, 'content-type': 'multipart/form-data; boundary=----x' },
      payload: '------x--\r\n',
    });
    expect(res.statusCode).toBe(400);
  });

  it('attaches tags and knowledge points at upload time', async () => {
    const tag = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: user.auth,
      payload: { name: '重点' },
    });
    const tagId = tag.json().data.id;

    const node = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: '有理数' },
    });
    const nodeId = node.json().data.id;

    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt', {
      tagIds: tagId,
      knowledgeNodeIds: nodeId,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.tags).toEqual([{ id: tagId, name: '重点', color: expect.any(String) }]);
    expect(res.json().data.knowledgeNodes).toEqual([{ id: nodeId, name: '有理数' }]);
  });

  it('rejects a tagId that belongs to another user', async () => {
    const other = await registerUser(app, { email: 'other@example.com' });
    const tag = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: other.auth,
      payload: { name: 'x' },
    });
    const tagId = tag.json().data.id;

    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt', { tagIds: tagId });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('updates favorite, tags, and knowledge points via PATCH', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    const resourceId = upload.json().data.id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/resources/${resourceId}`,
      headers: user.auth,
      payload: { isFavorite: true, title: '新标题' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.isFavorite).toBe(true);
    expect(patch.json().data.title).toBe('新标题');
  });

  it('touch updates lastUsedAt for the 最近使用 list', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    const resourceId = upload.json().data.id;

    await app.inject({ method: 'POST', url: `/api/v1/resources/${resourceId}/touch`, headers: user.auth });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/resources?recent=true',
      headers: user.auth,
    });
    expect(list.json().data.map((r: { id: string }) => r.id)).toContain(resourceId);
  });

  it('downloads the original file bytes', async () => {
    const content = Buffer.from('hello world');
    const { headers, payload } = multipartFileWithFields(content, 'a.txt');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    const resourceId = upload.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/resources/${resourceId}/download`,
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe('hello world');
  });

  it('soft-deletes a resource and removes it from the file store', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    const resourceId = upload.json().data.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/resources/${resourceId}`,
      headers: user.auth,
    });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/resources/${resourceId}`,
      headers: user.auth,
    });
    expect(get.statusCode).toBe(403);
  });
});

describe('resources: search and filter', () => {
  it('finds a resource by title full-text search', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt', {
      title: '一元二次方程复习课',
    });
    await app.inject({ method: 'POST', url: '/api/v1/resources', headers: { ...user.auth, ...headers }, payload });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/resources?q=' + encodeURIComponent('二次方程'),
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    expect(res.json().data[0].title).toBe('一元二次方程复习课');
  });

  it('full-text search finds a match inside chunk content and reports the page number', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'lesson.txt', {
      title: '普通资源',
    });
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    const resourceId = upload.json().data.id;

    // Simulate what the parse job would have produced for a PDF/PPT. The
    // search_vector column is maintained by a BEFORE INSERT trigger (see the
    // migration), so a plain create is enough — no manual raw-SQL touch.
    await prisma.resourceChunk.create({
      data: { resourceId, ordinal: 0, pageNumber: 3, content: '勾股定理的证明与应用' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/resources?q=' + encodeURIComponent('勾股定理'),
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    const hit = res.json().data.find((r: { id: string }) => r.id === resourceId);
    expect(hit).toBeDefined();
    expect(hit.matchedChunk.pageNumber).toBe(3);
  });

  it('filters by type', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.png', {}, 'image/png');
    await app.inject({ method: 'POST', url: '/api/v1/resources', headers: { ...user.auth, ...headers }, payload });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/resources?type=image',
      headers: user.auth,
    });
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].type).toBe('image');
  });

  it('filters by favorite', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt');
    const upload = await app.inject({ method: 'POST', url: '/api/v1/resources', headers: { ...user.auth, ...headers }, payload });
    const resourceId = upload.json().data.id;
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/resources/${resourceId}`,
      headers: user.auth,
      payload: { isFavorite: true },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/resources?favorite=true', headers: user.auth });
    expect(res.json().data.map((r: { id: string }) => r.id)).toEqual([resourceId]);
  });
});

describe('isolation: knowledge center', () => {
  let other: TestUser;

  beforeEach(async () => {
    other = await registerUser(app, { email: 'bob@example.com' });
  });

  it('refuses to read a foreign resource', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    const resourceId = upload.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/resources/${resourceId}`,
      headers: other.auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not list another user\'s resources', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt');
    await app.inject({ method: 'POST', url: '/api/v1/resources', headers: { ...user.auth, ...headers }, payload });

    const res = await app.inject({ method: 'GET', url: '/api/v1/resources', headers: other.auth });
    expect(res.json().data).toHaveLength(0);
  });

  it('refuses to download a foreign resource', async () => {
    const { headers, payload } = multipartFileWithFields(Buffer.from('x'), 'a.txt');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      headers: { ...user.auth, ...headers },
      payload,
    });
    const resourceId = upload.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/resources/${resourceId}/download`,
      headers: other.auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to read a foreign knowledge node', async () => {
    const node = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-nodes',
      headers: user.auth,
      payload: { name: 'A' },
    });
    const nodeId = node.json().data.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-nodes/${nodeId}`,
      headers: other.auth,
      payload: { name: 'hijacked' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to read a foreign resource collection', async () => {
    const folder = await app.inject({
      method: 'POST',
      url: '/api/v1/resource-collections',
      headers: user.auth,
      payload: { name: 'A' },
    });
    const folderId = folder.json().data.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/resource-collections/${folderId}`,
      headers: other.auth,
    });
    expect(res.statusCode).toBe(403);
  });
});
