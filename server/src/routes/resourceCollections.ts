/**
 * Collections/文件夹: an optional tree a teacher organizes resources into,
 * independent of type/subject/tags/knowledge points. A resource belongs to at
 * most one collection (collectionId nullable FK on Resource).
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireResourceCollection } from '../lib/ownership.js';

const createSchema = z.object({
  name: z.string().min(1, '文件夹名称不能为空').max(128),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchema = createSchema.partial();

export async function registerResourceCollectionRoutes(app: FastifyInstance) {
  app.get('/resource-collections', async (req) => {
    const userId = requireUser(req);
    const collections = await prisma.resourceCollection.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { resources: { where: { deletedAt: null } } } } },
    });

    return { data: collections.map(serializeCollection) };
  });

  app.post('/resource-collections', async (req, reply) => {
    const userId = requireUser(req);
    const body = createSchema.parse(req.body);
    if (body.parentId) await requireResourceCollection(body.parentId, userId);

    const collection = await prisma.resourceCollection.create({
      data: {
        userId,
        name: body.name.trim(),
        parentId: body.parentId ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    return reply.status(201).send({ data: serializeCollection({ ...collection, _count: { resources: 0 } }) });
  });

  app.patch('/resource-collections/:collectionId', async (req) => {
    const userId = requireUser(req);
    const { collectionId } = z.object({ collectionId: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    await requireResourceCollection(collectionId, userId);

    if (body.parentId) {
      if (body.parentId === collectionId) throw ApiError.businessRule('文件夹不能作为自己的父节点');
      await requireResourceCollection(body.parentId, userId);
    }

    const collection = await prisma.resourceCollection.update({
      where: { id: collectionId },
      data: { name: body.name?.trim(), parentId: body.parentId, sortOrder: body.sortOrder },
      include: { _count: { select: { resources: { where: { deletedAt: null } } } } },
    });

    return { data: serializeCollection(collection) };
  });

  app.delete('/resource-collections/:collectionId', async (req, reply) => {
    const userId = requireUser(req);
    const { collectionId } = z.object({ collectionId: z.string().uuid() }).parse(req.params);
    await requireResourceCollection(collectionId, userId);

    // This is a soft delete (an UPDATE), so the schema's onDelete: Cascade /
    // SetNull triggers — which only fire on a real SQL DELETE — don't apply.
    // Walk descendant folders explicitly, soft-delete them all, and detach
    // (collectionId: null) every resource that was directly inside any of
    // them, mirroring what the FK constraints would do on a hard delete.
    const ids = await collectDescendantIds(collectionId, userId);
    await prisma.$transaction([
      prisma.resource.updateMany({
        where: { userId, collectionId: { in: ids } },
        data: { collectionId: null },
      }),
      prisma.resourceCollection.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      }),
    ]);
    return reply.status(204).send();
  });
}

async function collectDescendantIds(rootId: string, userId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await prisma.resourceCollection.findMany({
      where: { userId, parentId: { in: frontier }, deletedAt: null },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}

function serializeCollection(c: {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  _count: { resources: number };
}) {
  return {
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    sortOrder: c.sortOrder,
    resourceCount: c._count.resources,
  };
}
