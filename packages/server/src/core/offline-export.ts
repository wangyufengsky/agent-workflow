import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError, ErrorCode } from '@aw/shared';

const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

export async function exportPathMetadata(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

export function invalidExportTarget(message: string): never {
  throw new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: ['targetDir'], message }] });
}

function within(path: string, base: string): boolean {
  const rel = relative(base, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

async function canonicalCandidate(path: string): Promise<string> {
  if ((await exportPathMetadata(path)) !== undefined) return realpath(path);
  return join(await canonicalCandidate(dirname(path)), basename(path));
}

export async function canonicalExportTarget(path: string, projectRoot: string | null): Promise<string> {
  if (!isAbsolute(path)) invalidExportTarget('The export directory must be absolute');
  const selected = resolve(path);
  const current = await exportPathMetadata(selected);
  if (current !== undefined && !current.isDirectory()) invalidExportTarget('The export target must be a directory');
  const target = await canonicalCandidate(selected);
  if (target === dirname(target)) invalidExportTarget('A filesystem root cannot be an export directory');
  if (projectRoot !== null) {
    const project = await canonicalCandidate(projectRoot);
    const localPaths = [join(project, 'docs', 'design'), join(project, '.git')];
    const protectedPaths = [...localPaths, ...(await Promise.all(localPaths.map(canonicalCandidate)))];
    if (within(project, target) || protectedPaths.some((path) => within(target, path) || within(path, target))) {
      invalidExportTarget('The export directory overlaps a protected project location');
    }
  }
  return target;
}

const targetQueues = new Map<string, Promise<void>>();

/** 同一规范目录的导出串行执行，避免检查和发布交错。 */
export async function withExportTargetLock<T>(targetDir: string, publish: () => Promise<T>): Promise<T> {
  const previous = targetQueues.get(targetDir);
  const queue = Promise.withResolvers<void>();
  targetQueues.set(targetDir, queue.promise);
  try {
    await previous;
    return await publish();
  } finally {
    queue.resolve();
    if (targetQueues.get(targetDir) === queue.promise) targetQueues.delete(targetDir);
  }
}
