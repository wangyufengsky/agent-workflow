import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { API_PREFIX, AppError, ErrorCode } from '@aw/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';
import type { BrowserService } from './browser.service.ts';

async function sendJpeg(reply: FastifyReply, path: string, file: string) {
  try {
    return await reply.type('image/jpeg').send(await readFile(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    throw new AppError(ErrorCode.NotFound, 'No such screenshot', { file });
  }
}

/**
 * Screenshots are files, not operations (03 §5, 29 §5.7): an attempt's screenshots and frames beside its
 * transcript, page checks' under `runs/<taskId>/browser/`.
 */
export function registerBrowserRoutes(server: FastifyInstance, browser: BrowserService, dataDir: string): void {
  server.get(`${API_PREFIX}/attempts/:attemptId/browser/:file`, async (req, reply) => {
    const { attemptId, file } = parseInput(z.object({ attemptId: z.string(), file: z.string() }), req.params);
    return sendJpeg(reply, browser.attemptFile(attemptId, file), file);
  });

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
    return sendJpeg(reply, path, file);
  });
}
