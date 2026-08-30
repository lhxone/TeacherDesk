import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

/** Convert Prisma Decimal / null into a plain number | null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : Number(v.toString());
}
