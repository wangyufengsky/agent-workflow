import { z } from 'zod';
import {
  createScheduleRequestSchema,
  listSchedulesQuerySchema,
  scheduleDetailSchema,
  scheduleSchema,
  updateScheduleRequestSchema,
} from '../contracts/api/schedules.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// Scheduled tasks are a simple-mode feature the assistant can use too (22 §10).
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;
const byId = z.object({ id: z.string() });

export const listSchedulesOp = defineOperationContract({
  ...common,
  id: 'schedules.list',
  title: 'op.schedules.list',
  description:
    'Scheduled tasks (a fixed workflow run automatically daily, weekly or every few hours) with their next run and latest run, newest first',
  input: listSchedulesQuerySchema,
  output: z.object({ items: z.array(scheduleSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/schedules' },
});

export const createScheduleOp = defineOperationContract({
  ...common,
  id: 'schedules.create',
  title: 'op.schedules.create',
  description:
    "Run a fixed workflow (not an AI-planned one) on a schedule while the app is open: each run starts an ordinary task whose result waits for the user's review and merge. Frequency: daily at HH:MM, weekly on chosen weekdays (0 = Sunday) at HH:MM, or every 1/2/3/4/6/8/12 hours from HH:MM, in the system time zone",
  input: createScheduleRequestSchema,
  output: scheduleDetailSchema,
  refs: { projectId: InputRef.Project, workflowKey: InputRef.Workflow },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/schedules', status: 201 },
  // The palette opens the new-schedule page (22 §9).
  expose: { palette: true, assistant: true },
  produces: { kind: EntityKind.Schedule, ref: (schedule) => ({ id: schedule.id, title: schedule.title }) },
});

export const getScheduleOp = defineOperationContract({
  ...common,
  id: 'schedules.get',
  title: 'op.schedules.get',
  description: 'A scheduled task with its latest runs: when each ran, whether it started a task, was skipped or failed',
  input: byId,
  output: scheduleDetailSchema,
  refs: { id: InputRef.Schedule },
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/schedules/:id' },
});

export const updateScheduleOp = defineOperationContract({
  ...common,
  id: 'schedules.update',
  title: 'op.schedules.update',
  description:
    "Change a scheduled task's workflow, requirement, frequency or base branch (null: the project's default branch); its project stays",
  input: updateScheduleRequestSchema,
  output: scheduleDetailSchema,
  refs: { id: InputRef.Schedule, workflowKey: InputRef.Workflow },
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/schedules/:id' },
});

export const pauseScheduleOp = defineOperationContract({
  ...common,
  id: 'schedules.pause',
  title: 'op.schedules.pause',
  description: 'Pause a scheduled task: it does not run until resumed',
  input: byId,
  output: scheduleDetailSchema,
  refs: { id: InputRef.Schedule },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/schedules/:id/pause' },
});

export const resumeScheduleOp = defineOperationContract({
  ...common,
  id: 'schedules.resume',
  title: 'op.schedules.resume',
  description: 'Resume a paused scheduled task; times missed while paused are not run',
  input: byId,
  output: scheduleDetailSchema,
  refs: { id: InputRef.Schedule },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/schedules/:id/resume' },
});

export const runScheduleOp = defineOperationContract({
  ...common,
  id: 'schedules.run',
  title: 'op.schedules.run',
  description:
    "Run a scheduled task once now, without changing its schedule; fails with SCHEDULE_BUSY while the previous run's task has not ended",
  input: byId,
  output: scheduleDetailSchema,
  refs: { id: InputRef.Schedule },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/schedules/:id/run' },
});

export const deleteScheduleOp = defineOperationContract({
  ...common,
  id: 'schedules.delete',
  title: 'op.schedules.delete',
  description: 'Delete a scheduled task and its run history; the tasks it started stay',
  input: byId,
  output: z.void(),
  refs: { id: InputRef.Schedule },
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/schedules/:id' },
});
