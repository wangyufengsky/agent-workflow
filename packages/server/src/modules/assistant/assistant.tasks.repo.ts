import { errorInfoSchema, TaskEventEntity, taskResultSchema } from '@aw/shared';
import { and, asc, desc, eq, gt, max } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { deliveriesTable } from '../delivery/index.ts';
import { tasksTable } from '../tasks/index.ts';
import { taskEventsTable } from '../timeline/index.ts';
import { assistantTaskFollowupsTable } from './assistant.table.ts';

export function createTaskFollowupsRepo(db: DbExecutor) {
  const followups = assistantTaskFollowupsTable;
  const tasks = tasksTable;
  const events = taskEventsTable;
  const deliveries = deliveriesTable;
  return {
    insert(taskId: string, conversationId: string, createdAt: number): void {
      db.insert(followups).values({ taskId, conversationId, createdAt }).run();
    },
    acknowledge(taskId: string, lastEventId: number): void {
      db.update(followups).set({ lastEventId }).where(eq(followups.taskId, taskId)).run();
    },
    conversationIds(): string[] {
      return db
        .select({ id: followups.conversationId })
        .from(followups)
        .groupBy(followups.conversationId)
        .all()
        .map((row) => row.id);
    },
    /** 启动补扫与实时消费共用一次批量查询，跳过节点进度事件。 */
    pending(taskId?: string) {
      const latest = db
        .select({ taskId: events.taskId, eventId: max(events.id).as('event_id') })
        .from(events)
        .where(
          and(eq(events.entity, TaskEventEntity.Task), taskId === undefined ? undefined : eq(events.taskId, taskId)),
        )
        .groupBy(events.taskId)
        .as('latest_task_event');
      return db
        .select({
          taskId: tasks.id,
          conversationId: followups.conversationId,
          eventId: events.id,
          eventType: events.type,
          occurredAt: events.createdAt,
          status: tasks.status,
          key: tasks.key,
          title: tasks.title,
          failedPhase: tasks.failedPhase,
          failure: tasks.failure,
          result: tasks.result,
          delivery: {
            id: deliveries.id,
            strategy: deliveries.strategy,
            status: deliveries.status,
            targetBranch: deliveries.targetBranch,
            commitSha: deliveries.commitSha,
            prUrl: deliveries.prUrl,
          },
        })
        .from(followups)
        .innerJoin(tasks, eq(tasks.id, followups.taskId))
        .innerJoin(latest, eq(latest.taskId, tasks.id))
        .innerJoin(events, eq(events.id, latest.eventId))
        .leftJoin(
          deliveries,
          eq(
            deliveries.id,
            db
              .select({ id: deliveries.id })
              .from(deliveries)
              .where(eq(deliveries.taskId, tasks.id))
              .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
              .limit(1),
          ),
        )
        .where(and(gt(events.id, followups.lastEventId), taskId === undefined ? undefined : eq(tasks.id, taskId)))
        .orderBy(asc(events.id))
        .all()
        .map(({ failure, result, ...row }) => ({
          ...row,
          failure: failure === null ? null : errorInfoSchema.parse(JSON.parse(failure)),
          result: result === null ? null : taskResultSchema.parse(JSON.parse(result)),
        }));
    },
  };
}
