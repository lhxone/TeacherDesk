import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireTag } from '../lib/ownership.js';

// Two fully separate namespaces sharing one table (see the Prisma schema's
// Tag model comment) — student tags (班级/学生管理) and resource tags (知识
// 中心). A request always says which one it means; nothing here infers scope
// from context, so a teacher's "课代表" in one feature never collides with
// or leaks into the other.
const scopeSchema = z.enum(['student', 'resource']);

export async function registerTagRoutes(app: FastifyInstance) {
  app.get('/tags', async (req) => {
    const userId = requireUser(req);
    const { scope } = z.object({ scope: scopeSchema.default('student') }).parse(req.query);
    const tags = await prisma.tag.findMany({
      where: { userId, scope },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { studentTags: true, resourceTags: true } } },
    });

    return {
      data: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        studentCount: t._count.studentTags,
        resourceCount: t._count.resourceTags,
      })),
    };
  });

  app.post('/tags', async (req, reply) => {
    const userId = requireUser(req);
    const body = z
      .object({
        scope: scopeSchema.default('student'),
        name: z.string().min(1, '标签名不能为空').max(32),
        color: z.string().max(16).optional(),
      })
      .parse(req.body);

    const existing = await prisma.tag.findFirst({ where: { userId, scope: body.scope, name: body.name.trim() } });
    if (existing) throw ApiError.conflict('同名标签已存在');

    const tag = await prisma.tag.create({
      data: { userId, scope: body.scope, name: body.name.trim(), color: body.color ?? '#10B981' },
    });

    return reply.status(201).send({
      data: { id: tag.id, name: tag.name, color: tag.color, studentCount: 0, resourceCount: 0 },
    });
  });

  app.patch('/tags/:tagId', async (req) => {
    const userId = requireUser(req);
    const { tagId } = z.object({ tagId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ name: z.string().min(1).max(32).optional(), color: z.string().max(16).optional() })
      .parse(req.body);

    const current = await requireTag(tagId, userId);

    if (body.name) {
      const clash = await prisma.tag.findFirst({
        where: { userId, scope: current.scope, name: body.name.trim(), id: { not: tagId } },
      });
      if (clash) throw ApiError.conflict('同名标签已存在');
    }

    const tag = await prisma.tag.update({
      where: { id: tagId },
      data: { name: body.name?.trim(), color: body.color },
    });

    return { data: { id: tag.id, name: tag.name, color: tag.color } };
  });

  app.delete('/tags/:tagId', async (req, reply) => {
    const userId = requireUser(req);
    const { tagId } = z.object({ tagId: z.string().uuid() }).parse(req.params);
    await requireTag(tagId, userId);

    // studentTags/resourceTags rows cascade, so associations drop with the tag.
    await prisma.tag.delete({ where: { id: tagId } });
    return reply.status(204).send();
  });
}
