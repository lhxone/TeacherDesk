/**
 * Knowledge-point tree (树形知识点管理). A user's nodes form one or more trees
 * (root nodes have parentId null); a resource can link to any number of nodes
 * via ResourceKnowledgeNode (see routes/resources.ts).
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireKnowledgeNode } from '../lib/ownership.js';

const createSchema = z.object({
  name: z.string().min(1, '知识点名称不能为空').max(128),
  parentId: z.string().uuid().nullable().optional(),
  subject: z.string().max(32).nullable().optional(),
  grade: z.string().max(32).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchema = createSchema.partial();

export async function registerKnowledgeNodeRoutes(app: FastifyInstance) {
  // Flat list with parentId, so the frontend builds the tree client-side (same
  // approach as everywhere else in this codebase that models a tree/list).
  app.get('/knowledge-nodes', async (req) => {
    const userId = requireUser(req);
    const q = z
      .object({ subject: z.string().optional(), grade: z.string().optional() })
      .parse(req.query);

    const nodes = await prisma.knowledgeNode.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(q.subject ? { subject: q.subject } : {}),
        ...(q.grade ? { grade: q.grade } : {}),
      },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { resourceKnowledge: true } } },
    });

    return { data: nodes.map(serializeNode) };
  });

  app.post('/knowledge-nodes', async (req, reply) => {
    const userId = requireUser(req);
    const body = createSchema.parse(req.body);

    if (body.parentId) await requireKnowledgeNode(body.parentId, userId);

    const node = await prisma.knowledgeNode.create({
      data: {
        userId,
        name: body.name.trim(),
        parentId: body.parentId ?? null,
        subject: body.subject ?? null,
        grade: body.grade ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    return reply.status(201).send({ data: serializeNode({ ...node, _count: { resourceKnowledge: 0 } }) });
  });

  app.patch('/knowledge-nodes/:nodeId', async (req) => {
    const userId = requireUser(req);
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    await requireKnowledgeNode(nodeId, userId);

    if (body.parentId) {
      if (body.parentId === nodeId) throw ApiError.businessRule('知识点不能作为自己的父节点');
      await requireKnowledgeNode(body.parentId, userId);
      await assertNotDescendant(nodeId, body.parentId);
    }

    const node = await prisma.knowledgeNode.update({
      where: { id: nodeId },
      data: {
        name: body.name?.trim(),
        parentId: body.parentId,
        subject: body.subject,
        grade: body.grade,
        sortOrder: body.sortOrder,
      },
      include: { _count: { select: { resourceKnowledge: true } } },
    });

    return { data: serializeNode(node) };
  });

  app.delete('/knowledge-nodes/:nodeId', async (req, reply) => {
    const userId = requireUser(req);
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(req.params);
    await requireKnowledgeNode(nodeId, userId);

    // The schema's onDelete: Cascade on parentId only fires for a real SQL
    // DELETE; this is a soft delete (an UPDATE), so descendants must be
    // walked and soft-deleted explicitly or they'd keep showing up under a
    // now-hidden parent. ResourceKnowledgeNode links for every affected node
    // still hard-cascade once (if ever) the row is truly deleted; until then
    // resources just lose visibility of these knowledge points, same as
    // before.
    const ids = await collectDescendantIds(nodeId, userId);
    await prisma.knowledgeNode.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
    return reply.status(204).send();
  });
}

async function collectDescendantIds(rootId: string, userId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await prisma.knowledgeNode.findMany({
      where: { userId, parentId: { in: frontier }, deletedAt: null },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}

/** Reject moving a node underneath one of its own descendants (would create a cycle). */
async function assertNotDescendant(nodeId: string, candidateParentId: string) {
  let current: string | null = candidateParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === nodeId) throw ApiError.businessRule('不能将知识点移动到其子节点下');
    if (seen.has(current)) break;
    seen.add(current);
    const parent: { parentId: string | null } | null = await prisma.knowledgeNode.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    current = parent?.parentId ?? null;
  }
}

function serializeNode(n: {
  id: string;
  name: string;
  parentId: string | null;
  subject: string | null;
  grade: string | null;
  sortOrder: number;
  _count: { resourceKnowledge: number };
}) {
  return {
    id: n.id,
    name: n.name,
    parentId: n.parentId,
    subject: n.subject,
    grade: n.grade,
    sortOrder: n.sortOrder,
    resourceCount: n._count.resourceKnowledge,
  };
}
