import { API_PREFIX } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../src/core/http/errors.ts';
import type { FakeOpencode, FakeStep } from './fake-opencode.ts';

const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit'), file: z.string(), content: z.string() }),
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool'),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    output: z.string().default(''),
  }),
  z.object({
    type: z.literal('callTool'),
    // Specs written for the execution MCP leave it out.
    server: z.enum(['exec', 'assistant']).default('exec'),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('permission'), permission: z.string(), patterns: z.array(z.string()) }),
  z.object({ type: z.literal('hang') }),
  z.object({ type: z.literal('usage'), input: z.number(), output: z.number(), cost: z.number() }),
  z.object({ type: z.literal('error'), name: z.string(), message: z.string(), idle: z.boolean().default(true) }),
]) satisfies z.ZodType<FakeStep>;

const bodySchema = z.object({
  steps: z.array(stepSchema),
  match: z
    .object({ title: z.string().optional(), agent: z.string().optional(), directory: z.string().optional() })
    .optional(),
});

/**
 * Development backend with FakeOpencode (browser E2E): lets a spec queue the model's turns, which it cannot do
 * from the browser otherwise. Never registered in production builds.
 */
export function registerFakeOpencodeRoutes(server: FastifyInstance, fake: FakeOpencode): void {
  server.post(`${API_PREFIX}/dev/fake-opencode/scripts`, async (req, reply) => {
    const { steps, match } = parseInput(bodySchema, req.body);
    const queued = { steps };
    if (match === undefined) fake.enqueue(queued);
    else {
      fake.enqueue(queued, {
        ...(match.title === undefined ? {} : { title: match.title }),
        ...(match.agent === undefined ? {} : { agent: match.agent }),
        ...(match.directory === undefined ? {} : { directory: match.directory }),
      });
    }
    return reply.code(204).send();
  });
}
