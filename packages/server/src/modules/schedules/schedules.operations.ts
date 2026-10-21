import {
  createScheduleOp,
  deleteScheduleOp,
  getScheduleOp,
  listSchedulesOp,
  pauseScheduleOp,
  resumeScheduleOp,
  runScheduleOp,
  updateScheduleOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { SchedulesService } from './schedules.service.ts';

export function schedulesOperations(schedules: SchedulesService) {
  return [
    implement(listSchedulesOp, (query) => ({ items: schedules.list(query) })),
    implement(createScheduleOp, (input) => schedules.create(input)),
    implement(getScheduleOp, ({ id }) => schedules.detail(id)),
    implement(updateScheduleOp, (input) => schedules.update(input)),
    implement(pauseScheduleOp, ({ id }) => schedules.pause(id)),
    implement(resumeScheduleOp, ({ id }) => schedules.resume(id)),
    implement(runScheduleOp, ({ id }) => schedules.run(id)),
    implement(deleteScheduleOp, ({ id }) => schedules.delete(id)),
  ];
}
