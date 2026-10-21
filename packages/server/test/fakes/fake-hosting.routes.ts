import { API_PREFIX } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../src/core/http/errors.ts';
import type { FakeHosting } from './fake-hosting.ts';

const messageSchema = z.object({ author: z.string(), body: z.string() });
const threadSchema = z.object({
  head: z.string(),
  path: z.string(),
  line: z.number(),
  messages: z.array(messageSchema),
});
const commentSchema = messageSchema.extend({ head: z.string() });

/**
 * Development backend with FakeHosting (browser E2E, J18): lets a spec play the reviewers of a pull request, which it
 * cannot do from the browser otherwise. Never registered in production builds.
 */
export function registerFakeHostingRoutes(server: FastifyInstance, fake: FakeHosting): void {
  server.post(`${API_PREFIX}/dev/fake-hosting/review-threads`, async (req, reply) => {
    const { head, ...thread } = parseInput(threadSchema, req.body);
    fake.addReviewThread(head, thread);
    return reply.code(204).send();
  });
  server.post(`${API_PREFIX}/dev/fake-hosting/comments`, async (req, reply) => {
    const { head, ...comment } = parseInput(commentSchema, req.body);
    fake.addComment(head, comment);
    return reply.code(204).send();
  });
}
