import { API_PREFIX } from '@aw/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './core/config.ts';
import { registerSystemRoutes } from './modules/system/system.routes.ts';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(API_PREFIX)) return;
    if (req.headers.authorization !== `Bearer ${config.apiToken}`) {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });
    }
  });

  registerSystemRoutes(app, config);

  if (config.webDir !== undefined) {
    await app.register(fastifyStatic, { root: config.webDir });
  }
  return app;
}
