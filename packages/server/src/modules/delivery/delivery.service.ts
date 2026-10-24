import { randomUUID } from 'node:crypto';
import {
  type DeliveryDTO,
  DeliveryEvent,
  type DeliveryStatus,
  type DeliveryStrategy,
  deliveryMachine,
  type ErrorInfo,
  type RequirementsDeliverySummary,
  ServerEventType,
  DeliveryStatus as Status,
  TaskEventEntity,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import { recordTaskEvent } from '../timeline/index.ts';
import { createDeliveriesRepo, type Delivery, type DeliveryChanges } from './delivery.repo.ts';

export type DeliveriesServiceDeps = { db: Db; unit: UnitOfWork; clock: Clock; log: Logger };

const toDto = ({ taskId: _taskId, ...delivery }: Delivery): DeliveryDTO => delivery;

/** Delivery records and their state machine (09 §7); the merge itself is `delivery.merge.ts`. */
export function createDeliveriesService({ db, unit, clock, log }: DeliveriesServiceDeps) {
  const repo = createDeliveriesRepo(db);

  function mustFind(id: string): Delivery {
    const delivery = repo.find(id);
    if (delivery === undefined) throw new Error(`Delivery ${id} disappeared`);
    return delivery;
  }

  function publish(delivery: Delivery): void {
    unit.publish({
      type: ServerEventType.DeliveryUpdated,
      data: { taskId: delivery.taskId, delivery: toDto(delivery) },
    });
  }

  function move(id: string, event: DeliveryEvent, changes: Omit<DeliveryChanges, 'finishedAt'>): DeliveryDTO {
    const delivery = mustFind(id);
    const to = transition(deliveryMachine, delivery.status, event);
    const now = clock.now();
    const updated = unit.transact(() => {
      repo.updateStatus(id, delivery.status, to, { ...changes, finishedAt: now });
      recordTaskEvent(db, {
        taskId: delivery.taskId,
        entity: TaskEventEntity.Delivery,
        entityId: id,
        type: event,
        fromStatus: delivery.status,
        toStatus: to,
        ...(changes.conflictFiles === undefined ? {} : { payload: { files: changes.conflictFiles } }),
        createdAt: now,
      });
      return mustFind(id);
    });
    log.info({ taskId: delivery.taskId, deliveryId: id, from: delivery.status, to, event }, 'delivery transition');
    publish(updated);
    return toDto(updated);
  }

  return {
    latest(taskId: string): DeliveryDTO | undefined {
      const delivery = repo.latest(taskId);
      return delivery === undefined ? undefined : toDto(delivery);
    },
    latestPullRequest(taskId: string): DeliveryDTO | undefined {
      const delivery = repo.latestPullRequest(taskId);
      return delivery === undefined ? undefined : toDto(delivery);
    },
    /** Deliveries cut short by the previous run, for recovery. */
    listRunning: (): Array<DeliveryDTO & { taskId: string }> => repo.listByStatus(Status.Running),

    /** A new delivery, `running` (09 §7). */
    /** `requirements`: the checklist as the user delivered it (31 §4), kept in the delivery's timeline event. */
    start(input: {
      taskId: string;
      strategy: DeliveryStrategy;
      targetBranch: string;
      requirements: RequirementsDeliverySummary | null;
    }): DeliveryDTO {
      const { requirements, ...row } = input;
      const id = randomUUID();
      const now = clock.now();
      const status: DeliveryStatus = Status.Running;
      return unit.transact(() => {
        repo.insert({ id, ...row, status, createdAt: now });
        recordTaskEvent(db, {
          taskId: input.taskId,
          entity: TaskEventEntity.Delivery,
          entityId: id,
          type: 'note',
          toStatus: status,
          payload: {
            strategy: input.strategy,
            targetBranch: input.targetBranch,
            ...(requirements === null ? {} : { requirements }),
          },
          createdAt: now,
        });
        const delivery = mustFind(id);
        publish(delivery);
        return toDto(delivery);
      });
    },
    succeed: (id: string, result: { commitSha?: string; prUrl?: string }) => move(id, DeliveryEvent.Succeeded, result),
    conflict: (id: string, files: string[], error: ErrorInfo) =>
      move(id, DeliveryEvent.Conflicted, { conflictFiles: files, error }),
    fail: (id: string, error: ErrorInfo) => move(id, DeliveryEvent.Failed, { error }),
  };
}
export type DeliveriesService = ReturnType<typeof createDeliveriesService>;
