import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../app.js';
import { requireTag } from '../lib/ownership.js';

export async function registerTagRoutes(app: FastifyInstance) {
  app.get('/tags', async (req) => {
    const userId = requireUser(req);
    const tags = await prisma.tag.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { studentTags: true } } },
    });

    return {
      data: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        studentCount: t._count.studentTags,
      })),
    };
  });

  app.post('/tags', async (req, reply) => {
    const userId = requireUser(req);
    const body = z
      .object({
        name: z.string().min(1, '标签名不能为空').max(32),
        color: z.string().max(16).optional(),
      })
      .parse(req.body);

    const existing = await prisma.tag.findFirst({ where: { userId, name: body.name.trim() } });
    if (existing) throw ApiError.conflict('同名标签已存在');

    const tag = await prisma.tag.create({
      data: { userId, name: body.name.trim(), color: body.color ?? '#10B981' },
    });

    return reply.status(201).send({
      data: { id: tag.id, name: tag.name, color: tag.color, studentCount: 0 },
    });
  });

  app.patch('/tags/:tagId', async (req) => {
    const userId = requireUser(req);
    const { tagId } = z.object({ tagId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ name: z.string().min(1).max(32).optional(), color: z.string().max(16).optional() })
      .parse(req.body);

    await requireTag(tagId, userId);

    if (body.name) {
      const clash = await prisma.tag.findFirst({
        where: { userId, name: body.name.trim(), id: { not: tagId } },
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

    // studentTags rows cascade, so student associations drop with the tag.
    await prisma.tag.delete({ where: { id: tagId } });
    return reply.status(204).send();
  });
}
