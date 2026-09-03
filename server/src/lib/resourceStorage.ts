/**
 * Original-file storage for the 教学知识中心 (Knowledge Center). Files live on
 * disk under `config.resourceStorageRoot` (a Docker volume in production);
 * Postgres only ever stores the relative path + metadata (goal requirement:
 * "PostgreSQL 只保存元数据、索引和解析后的文本").
 *
 * Layout: `<root>/<userId>/<resourceId><ext>` — namespaced by user so a stray
 * path bug can't serve one teacher's file under another's id, and the id
 * (not the original filename) is the on-disk name so uploads with identical
 * or hostile filenames never collide or escape the directory.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/** Extension kept only for convenience when eyeballing the volume; never trusted for parsing decisions. */
function safeExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

export function resourceStoragePath(userId: string, resourceId: string, originalFilename: string): string {
  return path.join(userId, `${resourceId}${safeExt(originalFilename)}`);
}

export function absoluteResourcePath(relativePath: string): string {
  const resolved = path.resolve(config.resourceStorageRoot, relativePath);
  const root = path.resolve(config.resourceStorageRoot);
  // Defence in depth against a relativePath that ever contained `..` — every
  // caller here constructs it itself via resourceStoragePath, but a future
  // caller reading a DB row should not be able to escape the storage root.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('resolved resource path escapes storage root');
  }
  return resolved;
}

export async function saveResourceFile(
  userId: string,
  resourceId: string,
  originalFilename: string,
  buffer: Buffer,
): Promise<{ relativePath: string; checksum: string }> {
  const relativePath = resourceStoragePath(userId, resourceId, originalFilename);
  const absPath = absoluteResourcePath(relativePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, buffer);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  return { relativePath, checksum };
}

export async function readResourceFile(relativePath: string): Promise<Buffer> {
  return fs.readFile(absoluteResourcePath(relativePath));
}

export async function deleteResourceFile(relativePath: string): Promise<void> {
  try {
    await fs.unlink(absoluteResourcePath(relativePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
