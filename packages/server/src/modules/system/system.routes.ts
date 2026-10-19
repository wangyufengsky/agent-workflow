import { API_PREFIX, type Health } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../core/config.ts';

export function registerSystemRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get(
    `${API_PREFIX}/system/health`,
    async (): Promise<Health> => ({
      status: 'ok',
      appVersion: config.appVersion,
      node: process.versions.node,
    }),
  );
}
