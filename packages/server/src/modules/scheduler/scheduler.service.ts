import { AttemptKind, type ServerEventType as EventType, ServerEventType, TaskStatus } from '@aw/shared';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { ModelSlots } from '../model-slots/index.ts';
import type { NodesService } from '../nodes/index.ts';
import type { SettingsService } from '../settings/index.ts';
import type { TasksService } from '../tasks/index.ts';
import { decide, type SchedulerSnapshot } from './scheduler.decide.ts';

export type SchedulerDeps = {
  tasks: TasksService;
  nodes: NodesService;
  attempts: AttemptsService;
  settings: SettingsService;
  slots: Pick<ModelSlots, 'backgroundLimit' | 'setBackgroundBusy'>;
  events: EventBus;
  log: Logger;
};

/** Changes that may open a slot or make work available; the scheduler never polls (03 §8). */
const TRIGGERS: ReadonlySet<EventType> = new Set([
  ServerEventType.TaskUpdated,
  ServerEventType.NodeUpdated,
  ServerEventType.AttemptUpdated,
  ServerEventType.SettingsUpdated,
  ServerEventType.RuntimeUpdated,
  // An interactive session ended, waits, or the queue emptied: tasks may take the slot (D186).
  ServerEventType.ModelSlotsUpdated,
]);

const SCHEDULED: readonly TaskStatus[] = [TaskStatus.Planning, TaskStatus.Running, TaskStatus.Paused];

/** Event-driven scheduler: each relevant event schedules one run; runs never overlap and repeat while triggered. */
export function createScheduler({ tasks, nodes, attempts, settings, slots, events, log }: SchedulerDeps) {
  let queued = false;
  let running = false;
  let again = false;

  function snapshot(): SchedulerSnapshot {
    const scheduled = tasks.listByStatus(SCHEDULED);
    const planning = new Set(
      attempts
        .listActiveAll()
        .filter((a) => a.kind === AttemptKind.Plan)
        .map((a) => a.taskId),
    );
    const byTask = Map.groupBy(nodes.listByTasks(scheduled.map((t) => t.id)), (n) => n.taskId);
    return {
      backgroundLimit: slots.backgroundLimit(),
      maxConcurrentNodesPerTask: settings.get('scheduler.maxConcurrentNodesPerTask'),
      runtimeReady: attempts.isReady(),
      tasks: scheduled
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((t) => ({ id: t.id, status: t.status, planning: planning.has(t.id), nodes: byTask.get(t.id) ?? [] })),
    };
  }

  async function runOnce(): Promise<void> {
    const decision = decide(snapshot());
    // Before anything starts: interactive requests asking meanwhile see the slots the tasks are about to take.
    slots.setBackgroundBusy(decision.busy);
    for (const nodeId of decision.depsMet) nodes.markReady(nodeId);
    for (const taskId of decision.failed) tasks.failRunning(taskId);
    for (const taskId of decision.finished) await tasks.finishRunning(taskId);
    for (const { taskId, nodeId } of decision.dispatch) nodes.dispatch(nodeId, tasks.runContext(taskId));
    for (const taskId of decision.startPlanning) tasks.startPlanning(taskId);
  }

  async function run(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = false;
    }
  }

  function trigger(): void {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      // A failed run has no caller; the next event schedules another one.
      run().catch((err: unknown) => log.error({ err }, 'scheduler run failed'));
    });
  }

  return {
    trigger,
    /** Starts reacting to events; called once recovery has settled the state left by the previous run. */
    start(): void {
      events.subscribe((event) => {
        if (TRIGGERS.has(event.type)) trigger();
      });
      trigger();
    },
  };
}
export type Scheduler = ReturnType<typeof createScheduler>;
