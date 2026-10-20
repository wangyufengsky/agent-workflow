import type { EventBus } from '../../core/event-bus.ts';
import { tasksOperations } from './tasks.operations.ts';
import { createTasksService } from './tasks.service.ts';
import type { TasksServiceDeps } from './tasks.state.ts';

export type { Task } from './tasks.repo.ts';
export type { TasksService } from './tasks.service.ts';

export function createTasksModule(deps: TasksServiceDeps & { events: EventBus }) {
  const service = createTasksService(deps);
  return { service, operations: tasksOperations(service) };
}
