import { createReadStream } from 'node:fs';
import { API_PREFIX } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EventBus } from '../../core/event-bus.ts';
import { parseInput } from '../../core/http/errors.ts';
import { tasksOperations } from './tasks.operations.ts';
import { createTasksService } from './tasks.service.ts';
import type { TasksServiceDeps } from './tasks.state.ts';

export { readTaskSkills, type Task } from './tasks.repo.ts';
export type { TasksService } from './tasks.service.ts';
export { tasksTable } from './tasks.table.ts';
export { createTestFollowups } from './tasks.test-followups.ts';

export function createTasksModule(deps: TasksServiceDeps & { events: EventBus }) {
  const service = createTasksService(deps);
  return {
    service,
    operations: tasksOperations(service),
    registerRoutes(server: FastifyInstance) {
      server.get(`${API_PREFIX}/tasks/:id/artifacts/:versionId/raw`, (request, reply) => {
        const { id, versionId } = parseInput(z.object({ id: z.string(), versionId: z.uuid() }), request.params);
        return reply
          .type('application/octet-stream')
          .header('x-content-type-options', 'nosniff')
          .send(createReadStream(service.artifacts.fileOf(id, versionId)));
      });
    },
  };
}
