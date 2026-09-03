/**
 * 教学知识中心 core route: upload, list/search, detail, update (tags /
 * knowledge points / favorite / collection), download and delete of teaching
 * resources (textbook / ppt / lesson_plan / image / mistake / document).
 *
 * Search (title/filename/tag/full-text) is native Postgres pg_trgm — `ILIKE`
 * + `similarity()` over trigram GIN indexes (see the migration) via
 * `$queryRawUnsafe`, joined back to Prisma-shaped rows for the rest of the
 * payload. Not tsvector: see the schema's Resource header comment for why.
 * No Elasticsearch/vector DB.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import {
  requireResource,
  requireResourceCollection,
  requireKnowledgeNode,
  requireTag,
} from '../lib/ownership.js';
import { paginate, pageMeta } from '../lib/pagination.js';
import { config } from '../config.js';
import { saveResourceFile, readResourceFile, deleteResourceFile } from '../lib/resourceStorage.js';
import { inferResourceType } from '../lib/resourceParsing.js';
import { scheduleResourceParse } from '../lib/resourceParseJob.js';

const RESOURCE_TYPES = ['textbook', 'ppt', 'lesson_plan', 'image', 'mistake', 'document', 'other'] as const;

const listQuerySchema = z.object({
  type: z.enum(RESOURCE_TYPES).optional(),
  subject: z.string().optional(),
  grade: z.string().optional(),
  collectionId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  knowledgeNodeId: z.string().uuid().optional(),
  status: z.enum(['pending', 'parsing', 'ready', 'failed']).optional(),
  favorite: z.coerce.boolean().optional(),
  recent: z.coerce.boolean().optional(),
  // Full-text query across title/filename/tags/subject/grade and chunk content.
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  subject: z.string().max(32).nullable().optional(),
  grade: z.string().max(32).nullable().optional(),
  note: z.string().nullable().optional(),
  collectionId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  knowledgeNodeIds: z.array(z.string().uuid()).optional(),
  type: z.enum(RESOURCE_TYPES).optional(),
});

export async function registerResourceRoutes(app: FastifyInstance) {
  app.get('/resources', async (req) => {
    const userId = requireUser(req);
    const q = listQuerySchema.parse(req.query);
    const { skip, take } = paginate(q.page, q.pageSize);

    // Full-text branch: rank by search_vector + chunk content match, restricted
    // to this user, then apply the same filters and paginate in SQL so the
    // count/pages stay accurate.
    if (q.q && q.q.trim()) {
      return searchResources(userId, q, skip, take);
    }

    const where = {
      userId,
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.subject ? { subject: q.subject } : {}),
      ...(q.grade ? { grade: q.grade } : {}),
      ...(q.collectionId ? { collectionId: q.collectionId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.favorite ? { isFavorite: true } : {}),
      ...(q.tagId ? { tags: { some: { tagId: q.tagId } } } : {}),
      ...(q.knowledgeNodeId ? { knowledge: { some: { knowledgeNodeId: q.knowledgeNodeId } } } : {}),
    };

    const orderBy = q.recent ? [{ lastUsedAt: 'desc' as const }] : [{ createdAt: 'desc' as const }];

    const [rows, total] = await Promise.all([
      prisma.resource.findMany({
        where: q.recent ? { ...where, lastUsedAt: { not: null } } : where,
        orderBy,
        skip,
        take,
        include: resourceInclude,
      }),
      prisma.resource.count({ where: q.recent ? { ...where, lastUsedAt: { not: null } } : where }),
    ]);

    return { data: rows.map(serializeResource), meta: pageMeta(q.page, q.pageSize, total) };
  });

  app.get('/resources/:resourceId', async (req) => {
    const userId = requireUser(req);
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(req.params);
    await requireResource(resourceId, userId);

    const resource = await prisma.resource.findFirstOrThrow({
      where: { id: resourceId },
      include: {
        ...resourceInclude,
        chunks: { orderBy: { ordinal: 'asc' } },
      },
    });

    return { data: { ...serializeResource(resource), chunks: resource.chunks.map(serializeChunk) } };
  });

  app.post('/resources', async (req, reply) => {
    const userId = requireUser(req);

    const file = await req.file({ limits: { fileSize: config.resourceMaxFileSizeBytes, files: 1 } });
    if (!file) throw ApiError.validation('请上传文件');

    // Non-file fields arrive on file.fields when attachFieldsToBody isn't set.
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const body = z
      .object({
        title: z.string().min(1).max(255).optional(),
        type: z.enum(RESOURCE_TYPES).optional(),
        subject: z.string().max(32).optional(),
        grade: z.string().max(32).optional(),
        note: z.string().optional(),
        collectionId: z.string().uuid().optional(),
        tagIds: z.string().optional(), // comma-separated
        knowledgeNodeIds: z.string().optional(), // comma-separated
      })
      .parse({
        title: fields.title?.value,
        type: fields.type?.value,
        subject: fields.subject?.value,
        grade: fields.grade?.value,
        note: fields.note?.value,
        collectionId: fields.collectionId?.value,
        tagIds: fields.tagIds?.value,
        knowledgeNodeIds: fields.knowledgeNodeIds?.value,
      });

    if (body.collectionId) await requireResourceCollection(body.collectionId, userId);
    const tagIds = body.tagIds ? body.tagIds.split(',').filter(Boolean) : [];
    const knowledgeNodeIds = body.knowledgeNodeIds ? body.knowledgeNodeIds.split(',').filter(Boolean) : [];
    await assertOwnedTags(tagIds, userId);
    await assertOwnedKnowledgeNodes(knowledgeNodeIds, userId);

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw ApiError.validation(
          `文件过大，最大支持 ${Math.floor(config.resourceMaxFileSizeBytes / (1024 * 1024))}MB`,
        );
      }
      throw err;
    }

    const type = body.type ?? inferResourceType(file.mimetype, file.filename);
    const title = body.title?.trim() || stripExtension(file.filename);

    const resource = await prisma.resource.create({
      data: {
        userId,
        type,
        title,
        subject: body.subject ?? null,
        grade: body.grade ?? null,
        note: body.note ?? null,
        collectionId: body.collectionId ?? null,
        originalFilename: file.filename,
        mimeType: file.mimetype,
        fileSize: BigInt(buffer.length),
        storagePath: '', // filled in right after, once we have the resource id
        status: 'pending',
        tags: { create: tagIds.map((tagId) => ({ tagId, userId })) },
        knowledge: { create: knowledgeNodeIds.map((knowledgeNodeId) => ({ knowledgeNodeId })) },
      },
    });

    const { relativePath, checksum } = await saveResourceFile(userId, resource.id, file.filename, buffer);
    const saved = await prisma.resource.update({
      where: { id: resource.id },
      data: { storagePath: relativePath, checksum },
      include: resourceInclude,
    });

    scheduleResourceParse(resource.id);

    return reply.status(201).send({ data: serializeResource(saved) });
  });

  app.patch('/resources/:resourceId', async (req) => {
    const userId = requireUser(req);
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    await requireResource(resourceId, userId);

    if (body.collectionId) await requireResourceCollection(body.collectionId, userId);
    if (body.tagIds) await assertOwnedTags(body.tagIds, userId);
    if (body.knowledgeNodeIds) await assertOwnedKnowledgeNodes(body.knowledgeNodeIds, userId);

    await prisma.$transaction(async (tx) => {
      if (body.tagIds) {
        await tx.resourceTag.deleteMany({ where: { resourceId } });
        if (body.tagIds.length) {
          await tx.resourceTag.createMany({
            data: body.tagIds.map((tagId) => ({ resourceId, tagId, userId })),
          });
        }
      }
      if (body.knowledgeNodeIds) {
        await tx.resourceKnowledgeNode.deleteMany({ where: { resourceId } });
        if (body.knowledgeNodeIds.length) {
          await tx.resourceKnowledgeNode.createMany({
            data: body.knowledgeNodeIds.map((knowledgeNodeId) => ({ resourceId, knowledgeNodeId })),
          });
        }
      }
      await tx.resource.update({
        where: { id: resourceId },
        data: {
          title: body.title?.trim(),
          subject: body.subject,
          grade: body.grade,
          note: body.note,
          collectionId: body.collectionId,
          isFavorite: body.isFavorite,
          type: body.type,
        },
      });
    });

    const resource = await prisma.resource.findFirstOrThrow({
      where: { id: resourceId },
      include: resourceInclude,
    });
    return { data: serializeResource(resource) };
  });

  // "Use" a resource: bumps lastUsedAt for the 最近使用 list. Called by the
  // frontend when a resource is opened/previewed/downloaded.
  app.post('/resources/:resourceId/touch', async (req) => {
    const userId = requireUser(req);
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(req.params);
    await requireResource(resourceId, userId);

    await prisma.resource.update({ where: { id: resourceId }, data: { lastUsedAt: new Date() } });
    return { data: { ok: true } };
  });

  app.get('/resources/:resourceId/download', async (req, reply) => {
    const userId = requireUser(req);
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(req.params);
    const resource = await requireResource(resourceId, userId);

    const buffer = await readResourceFile(resource.storagePath);
    await prisma.resource.update({ where: { id: resourceId }, data: { lastUsedAt: new Date() } });

    return reply
      .header('Content-Type', resource.mimeType || 'application/octet-stream')
      .header(
        'Content-Disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(resource.originalFilename)}`,
      )
      .send(buffer);
  });

  app.post('/resources/:resourceId/retry', async (req) => {
    const userId = requireUser(req);
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(req.params);
    const resource = await requireResource(resourceId, userId);

    if (resource.status !== 'failed') {
      throw ApiError.businessRule('只有解析失败的资源可以重试');
    }
    await prisma.resource.update({ where: { id: resourceId }, data: { status: 'pending', parseError: null } });
    scheduleResourceParse(resourceId);
    return { data: { ok: true } };
  });

  app.delete('/resources/:resourceId', async (req, reply) => {
    const userId = requireUser(req);
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(req.params);
    const resource = await requireResource(resourceId, userId);

    await prisma.resource.update({ where: { id: resourceId }, data: { deletedAt: new Date() } });
    // Best-effort: the DB row is the source of truth (soft delete), so a file
    // left behind by a failed unlink is orphaned disk space, not a data bug.
    await deleteResourceFile(resource.storagePath).catch(() => {});

    return reply.status(204).send();
  });
}

const resourceInclude = {
  tags: { include: { tag: true } },
  knowledge: { include: { knowledgeNode: true } },
  collection: true,
} as const;

type ResourceRow = {
  id: string;
  type: string;
  title: string;
  subject: string | null;
  grade: string | null;
  note: string | null;
  collectionId: string | null;
  originalFilename: string;
  mimeType: string;
  fileSize: bigint;
  status: string;
  parseError: string | null;
  pageCount: number | null;
  isFavorite: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tags: { tag: { id: string; name: string; color: string } }[];
  knowledge: { knowledgeNode: { id: string; name: string } }[];
  collection: { id: string; name: string } | null;
};

function serializeResource(r: ResourceRow) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    subject: r.subject,
    grade: r.grade,
    note: r.note,
    collection: r.collection ? { id: r.collection.id, name: r.collection.name } : null,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    fileSize: Number(r.fileSize),
    status: r.status,
    parseError: r.parseError,
    pageCount: r.pageCount,
    isFavorite: r.isFavorite,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    tags: r.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    knowledgeNodes: r.knowledge.map((k) => ({ id: k.knowledgeNode.id, name: k.knowledgeNode.name })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeChunk(c: { id: string; ordinal: number; pageNumber: number | null; sectionLabel: string | null; content: string }) {
  return {
    id: c.id,
    ordinal: c.ordinal,
    pageNumber: c.pageNumber,
    sectionLabel: c.sectionLabel,
    content: c.content,
  };
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

async function assertOwnedTags(tagIds: string[], userId: string) {
  for (const id of [...new Set(tagIds)]) await requireTag(id, userId);
}

async function assertOwnedKnowledgeNodes(ids: string[], userId: string) {
  for (const id of [...new Set(ids)]) await requireKnowledgeNode(id, userId);
}

/**
 * Full-text search across title / original filename / attached tag names OR
 * any of its chunks' body content, scoped to the caller and the same filters
 * as the plain list endpoint. Uses pg_trgm (`ILIKE` + `similarity()`), not
 * tsvector — see the schema/migration header comment on Resource for why.
 * Returns hits with the matching chunk (for a page/section deep link) when
 * the match came from chunk content.
 */
async function searchResources(
  userId: string,
  q: z.infer<typeof listQuerySchema>,
  skip: number,
  take: number,
) {
  const term = q.q!.trim();
  const likeTerm = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  // Every placeholder is cast explicitly: node-postgres sends parameters as
  // untyped text, and without a cast Postgres can't unify e.g. `uuid = $1`
  // (42883 "operator does not exist") since it won't infer uuid from a bare
  // string parameter the way it does for a literal.
  const filterClauses: string[] = ['r.user_id = $1::uuid', 'r.deleted_at IS NULL'];
  const params: unknown[] = [userId];
  let i = 2;
  if (q.type) { filterClauses.push(`r.type = $${i++}::varchar`); params.push(q.type); }
  if (q.subject) { filterClauses.push(`r.subject = $${i++}::varchar`); params.push(q.subject); }
  if (q.grade) { filterClauses.push(`r.grade = $${i++}::varchar`); params.push(q.grade); }
  if (q.collectionId) { filterClauses.push(`r.collection_id = $${i++}::uuid`); params.push(q.collectionId); }
  if (q.status) { filterClauses.push(`r.status = $${i++}::varchar`); params.push(q.status); }
  if (q.favorite) { filterClauses.push('r.is_favorite = true'); }
  if (q.tagId) {
    filterClauses.push(
      `EXISTS (SELECT 1 FROM resource_tags rt2 WHERE rt2.resource_id = r.id AND rt2.tag_id = $${i++}::uuid)`,
    );
    params.push(q.tagId);
  }
  if (q.knowledgeNodeId) {
    filterClauses.push(
      `EXISTS (SELECT 1 FROM resource_knowledge_nodes rk WHERE rk.resource_id = r.id AND rk.knowledge_node_id = $${i++}::uuid)`,
    );
    params.push(q.knowledgeNodeId);
  }

  const likeParamIndex = i++;
  params.push(likeTerm);
  const simParamIndex = i++;
  params.push(term);

  const filterSql = filterClauses.join(' AND ');

  // Two match sources, unioned then de-duplicated by resource, best
  // similarity wins:
  //  - resource-level metadata match (title / filename / attached tag name)
  //  - chunk-level content match (also surfaces which chunk matched, for a
  //    page/section deep link)
  const sql = `
    WITH resource_hits AS (
      SELECT r.id AS resource_id, NULL::uuid AS chunk_id, NULL::int AS page_number,
             NULL::text AS section_label, NULL::text AS snippet,
             GREATEST(
               similarity(r.title, $${simParamIndex}),
               similarity(r.original_filename, $${simParamIndex}),
               COALESCE((
                 SELECT MAX(similarity(t.name, $${simParamIndex}))
                 FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
                 WHERE rt.resource_id = r.id
               ), 0)
             ) AS rank
      FROM resources r
      WHERE ${filterSql} AND (
        r.title ILIKE $${likeParamIndex} ESCAPE '\\'
        OR r.original_filename ILIKE $${likeParamIndex} ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
          WHERE rt.resource_id = r.id AND t.name ILIKE $${likeParamIndex} ESCAPE '\\'
        )
      )
    ),
    chunk_hits AS (
      SELECT r.id AS resource_id, c.id AS chunk_id, c.page_number, c.section_label,
             -- Cheap plain-text snippet: a window of content around the first
             -- match, no ts_headline (that's tsvector-only).
             substring(c.content FROM GREATEST(1, POSITION(LOWER($${simParamIndex}) IN LOWER(c.content)) - 20) FOR 120) AS snippet,
             similarity(c.content, $${simParamIndex}) AS rank
      FROM resource_chunks c
      JOIN resources r ON r.id = c.resource_id
      WHERE ${filterSql} AND c.content ILIKE $${likeParamIndex} ESCAPE '\\'
    ),
    combined AS (
      SELECT * FROM resource_hits
      UNION ALL
      SELECT * FROM chunk_hits
    ),
    best AS (
      SELECT DISTINCT ON (resource_id) resource_id, chunk_id, page_number, section_label, snippet, rank
      FROM combined
      ORDER BY resource_id, rank DESC
    )
    SELECT * FROM best ORDER BY rank DESC
    OFFSET $${i++} LIMIT $${i++}
  `;

  const countSql = `
    WITH resource_hits AS (
      SELECT r.id AS resource_id
      FROM resources r
      WHERE ${filterSql} AND (
        r.title ILIKE $${likeParamIndex} ESCAPE '\\'
        OR r.original_filename ILIKE $${likeParamIndex} ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
          WHERE rt.resource_id = r.id AND t.name ILIKE $${likeParamIndex} ESCAPE '\\'
        )
      )
    ),
    chunk_hits AS (
      SELECT r.id AS resource_id
      FROM resource_chunks c
      JOIN resources r ON r.id = c.resource_id
      WHERE ${filterSql} AND c.content ILIKE $${likeParamIndex} ESCAPE '\\'
    )
    SELECT COUNT(DISTINCT resource_id)::int AS count FROM (
      SELECT resource_id FROM resource_hits UNION SELECT resource_id FROM chunk_hits
    ) x
  `;

  type HitRow = {
    resource_id: string;
    chunk_id: string | null;
    page_number: number | null;
    section_label: string | null;
    snippet: string | null;
    rank: number;
  };

  const [hits, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<HitRow[]>(sql, ...params, skip, take),
    prisma.$queryRawUnsafe<{ count: number }[]>(countSql, ...params),
  ]);

  if (hits.length === 0) {
    return { data: [], meta: pageMeta(q.page, q.pageSize, countRows[0]?.count ?? 0) };
  }

  const resourceIds = hits.map((h) => h.resource_id);
  const rows = await prisma.resource.findMany({
    where: { id: { in: resourceIds } },
    include: resourceInclude,
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const data = hits
    .map((h) => {
      const row = rowById.get(h.resource_id);
      if (!row) return null;
      return {
        ...serializeResource(row),
        matchedChunk: h.chunk_id
          ? { id: h.chunk_id, pageNumber: h.page_number, sectionLabel: h.section_label, snippet: h.snippet }
          : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return { data, meta: pageMeta(q.page, q.pageSize, countRows[0]?.count ?? 0) };
}
