/**
 * Background parse job for uploaded resources. "Background" here means
 * off the request/response cycle of the upload call, not a separate process
 * or queue — the goal explicitly rules out extra microservices, and a single
 * API instance with `setImmediate` is enough at this scale (one teacher's
 * uploads, not a shared ingestion pipeline). If TeacherDesk ever runs
 * multiple API replicas, this is the seam to swap for a real job table +
 * worker poll loop; `Resource.status` already models pending/parsing/ready/
 * failed for that migration to slot into without a schema change.
 */
import { prisma } from '../db.js';
import { readResourceFile } from './resourceStorage.js';
import { extractText, isParseable } from './resourceParsing.js';

type Logger = { warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
let jobLogger: Logger | undefined;
export function setResourceParseLogger(logger: Logger) {
  jobLogger = logger;
}

/** Fire-and-forget: schedule parsing for one resource right after upload. */
export function scheduleResourceParse(resourceId: string): void {
  setImmediate(() => {
    void parseResource(resourceId).catch((err) => {
      jobLogger?.error({ err, resourceId }, 'resource parse job crashed');
    });
  });
}

/** True for Prisma's "record to update/delete not found" (P2025). */
function isMissingRecordError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';
}

export async function parseResource(resourceId: string): Promise<void> {
  const resource = await prisma.resource.findFirst({ where: { id: resourceId, deletedAt: null } });
  if (!resource) return;

  try {
    if (!isParseable(resource.mimeType, resource.originalFilename)) {
      // Images and unsupported document formats need no extraction; they're
      // searchable/browsable by metadata alone from the moment they're ready.
      await prisma.resource.update({ where: { id: resourceId }, data: { status: 'ready' } });
      return;
    }

    await prisma.resource.update({ where: { id: resourceId }, data: { status: 'parsing' } });

    const buffer = await readResourceFile(resource.storagePath);
    const { chunks, pageCount } = await extractText(buffer, resource.mimeType, resource.originalFilename);

    await prisma.$transaction([
      prisma.resourceChunk.deleteMany({ where: { resourceId } }),
      ...chunks.map((c) =>
        prisma.resourceChunk.create({
          data: {
            resourceId,
            ordinal: c.ordinal,
            pageNumber: c.pageNumber ?? null,
            sectionLabel: c.sectionLabel ?? null,
            content: c.content,
          },
        }),
      ),
      prisma.resource.update({
        where: { id: resourceId },
        data: { status: 'ready', pageCount: pageCount ?? null, parseError: null },
      }),
    ]);
  } catch (err) {
    // The resource can legitimately vanish mid-flight — deleted by the user
    // (or, in tests, the fixture table truncated) while this background job
    // was still running. That's not a parse failure, just a lost race; only
    // a real extraction error should flip the resource to 'failed'.
    if (isMissingRecordError(err)) return;

    jobLogger?.warn({ err, resourceId }, 'resource parsing failed');
    await prisma.resource
      .update({
        where: { id: resourceId },
        data: { status: 'failed', parseError: err instanceof Error ? err.message : String(err) },
      })
      .catch((updateErr) => {
        if (!isMissingRecordError(updateErr)) throw updateErr;
      });
  }
}
