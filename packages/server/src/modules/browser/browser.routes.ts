import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { API_PREFIX, AppError, ErrorCode } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';

/** Screenshots are files, not operations (03 §5): page checks' under `runs/<taskId>/browser/` (29 §5.7). */
export function registerBrowserRoutes(server: FastifyInstance, dataDir: string): void {
  server.get(`${API_PREFIX}/tasks/:taskId/browser/*`, async (req, reply) => {
    const { taskId, '*': file } = parseInput(
      z.object({ taskId: z.string().regex(/^[\w-]+$/), '*': z.string() }),
      req.params,
    );
    const base = resolve(dataDir, 'runs', taskId, 'browser');
    const path = resolve(base, file);
    // Only screenshots inside the task's folder: `..` or another extension reads nothing else.
    if (relative(base, path).startsWith(`..${sep}`) || !path.endsWith('.jpg')) {
      throw new AppError(ErrorCode.NotFound, 'No such screenshot', { file });
    }
    try {
      return await reply.type('image/jpeg').send(await readFile(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      throw new AppError(ErrorCode.NotFound, 'No such screenshot', { file });
    }
  });
}
