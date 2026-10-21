import { ServerEventType } from '@aw/shared';
import type { EventBus } from '../../core/event-bus.ts';
import { schedulesOperations } from './schedules.operations.ts';
import { createSchedulesService, type SchedulesServiceDeps } from './schedules.service.ts';
import { createScheduleTimer } from './schedules.timer.ts';

export type { SchedulesService } from './schedules.service.ts';
export type { ScheduleTimer } from './schedules.timer.ts';

/** The schedules and their timer, which starts once the API listens and re-arms whenever a schedule changes. */
export function createSchedulesModule(deps: SchedulesServiceDeps & { events: EventBus }) {
  const service = createSchedulesService(deps);
  const timer = createScheduleTimer({
    clock: deps.clock,
    log: deps.log,
    nextDue: service.nextDue,
    runDue: service.runDue,
  });
  deps.events.subscribe((event) => {
    if (event.type === ServerEventType.ScheduleUpdated) timer.rearm();
  });
  return { service, timer, operations: schedulesOperations(service) };
}
