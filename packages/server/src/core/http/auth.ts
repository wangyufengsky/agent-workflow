import { timingSafeEqual } from 'node:crypto';
import { API_PREFIX, AppError, ErrorCode } from '@aw/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** EventSource cannot send headers, so the SSE endpoint takes the token as `?token=` (11 §11). */
export const QUERY_TOKEN_PATHS = [`${API_PREFIX}/events`];

function presentedToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const path = req.url.split('?')[0] ?? '';
  if (!QUERY_TOKEN_PATHS.includes(path)) return undefined;
  return new URLSearchParams(req.url.slice(path.length)).get('token') ?? undefined;
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Every `/api/v1` request must carry the per-launch renderer token. */
export function registerTokenAuth(app: FastifyInstance, apiToken: string): void {
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith(API_PREFIX)) return;
    const token = presentedToken(req);
    if (token === undefined || !sameToken(token, apiToken)) {
      throw new AppError(ErrorCode.Unauthorized, 'Missing or invalid token');
    }
  });
}
