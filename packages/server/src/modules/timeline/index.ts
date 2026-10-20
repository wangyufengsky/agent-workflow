import type { DbExecutor } from '../../core/db/database.ts';
import { createTimelineRepo, type NewTaskEvent } from './timeline.repo.ts';

export type { NewTaskEvent } from './timeline.repo.ts';

/**
 * `task_events` (10): every state change of a task, its nodes, plans and attempts, written in the transaction of the
 * change (09 §1). Read through the task timeline operation.
 */
export function recordTaskEvent(tx: DbExecutor, event: NewTaskEvent): void {
  createTimelineRepo(tx).insert(event);
}

export function listTaskEvents(db: DbExecutor, taskId: string, afterId: number) {
  return createTimelineRepo(db).list(taskId, afterId);
}
