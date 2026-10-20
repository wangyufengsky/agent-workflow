import type { TaskEventDTO, TaskEventEntity } from '@aw/shared';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { taskEventsTable } from './timeline.table.ts';

export type NewTaskEvent = {
  taskId: string;
  entity: TaskEventEntity;
  entityId: string;
  type: string;
  fromStatus?: string;
  toStatus?: string;
  payload?: Record<string, unknown>;
  createdAt: number;
};

const payloadSchema = z.record(z.string(), z.unknown());

export function createTimelineRepo(db: DbExecutor) {
  return {
    insert(event: NewTaskEvent): void {
      db.insert(taskEventsTable)
        .values({
          taskId: event.taskId,
          entity: event.entity,
          entityId: event.entityId,
          type: event.type,
          fromStatus: event.fromStatus ?? null,
          toStatus: event.toStatus ?? null,
          payload: event.payload === undefined ? null : JSON.stringify(event.payload),
          createdAt: event.createdAt,
        })
        .run();
    },
    /** Id of the newest event matching the filter, or 0 when there is none (ids start at 1). */
    latestId(taskId: string, filter: { entity: TaskEventEntity; type: string; entityId?: string }): number {
      const row = db
        .select({ id: taskEventsTable.id })
        .from(taskEventsTable)
        .where(
          and(
            eq(taskEventsTable.taskId, taskId),
            eq(taskEventsTable.entity, filter.entity),
            eq(taskEventsTable.type, filter.type),
            ...(filter.entityId === undefined ? [] : [eq(taskEventsTable.entityId, filter.entityId)]),
          ),
        )
        .orderBy(desc(taskEventsTable.id))
        .get();
      return row?.id ?? 0;
    },
    list(taskId: string, afterId: number): TaskEventDTO[] {
      return db
        .select()
        .from(taskEventsTable)
        .where(and(eq(taskEventsTable.taskId, taskId), gt(taskEventsTable.id, afterId)))
        .orderBy(asc(taskEventsTable.id))
        .all()
        .map(({ taskId: _taskId, payload, ...row }) => ({
          ...row,
          payload: payload === null ? null : payloadSchema.parse(JSON.parse(payload)),
        }));
    },
  };
}
