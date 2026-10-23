import {
  type CompanionNotice,
  type InboxItemDTO,
  InboxKind,
  InboxStatus,
  TaskStatus,
  type TaskSummaryDTO,
} from '@aw/shared';
import { COMPANION_COPY as C } from '../../copy/companion.ts';

type Task = Pick<TaskSummaryDTO, 'id' | 'key' | 'title' | 'status' | 'updatedAt'>;
const taskNotice = (task: Task): Omit<CompanionNotice, 'system'> | undefined => {
  const title =
    task.status === TaskStatus.Review
      ? C.review
      : task.status === TaskStatus.Completed
        ? C.completed
        : task.status === TaskStatus.Failed
          ? C.failed
          : undefined;
  if (title === undefined) return;
  return {
    id: `task:${task.id}:${task.status}:${task.updatedAt}`,
    title,
    body: `${task.key} · ${task.title}`,
    path: `/tasks/${encodeURIComponent(task.id)}`,
    mood: task.status === TaskStatus.Failed ? 'error' : 'success',
  };
};

/** 只保留通知判重所需的前态；业务状态仍由服务器和 Query 缓存拥有。 */
export function createCompanionNotifications(emit: (notice: Omit<CompanionNotice, 'system'>) => void) {
  const tasks = new Map<string, Task>();
  const inbox = new Set<string>();
  let initialized = false;
  const task = (next: Task, live = true) => {
    const before = tasks.get(next.id);
    if (before !== undefined && next.updatedAt < before.updatedAt) return;
    if ((live || initialized) && before?.status !== next.status) {
      const notice = taskNotice(next);
      if (notice !== undefined) emit(notice);
    }
    tasks.set(next.id, next);
  };
  const item = (next: InboxItemDTO, live = true) => {
    const seen = inbox.has(next.id);
    inbox.add(next.id);
    // 任务失败、交付已由任务状态提醒，避免同一件事提醒两次。
    if (
      seen ||
      (!live && !initialized) ||
      next.status !== InboxStatus.Open ||
      next.kind === InboxKind.Failure ||
      next.kind === InboxKind.Delivery ||
      (next.kind === InboxKind.Question && !next.payload.blocking)
    )
      return;
    emit({
      id: `inbox:${next.id}`,
      title: C.attention,
      body: next.title,
      path: next.taskId === null ? '/inbox' : `/tasks/${encodeURIComponent(next.taskId)}`,
      mood: 'waiting',
    });
  };
  return {
    task,
    item,
    snapshot(allTasks: readonly Task[], allInbox: readonly InboxItemDTO[]) {
      for (const next of allTasks) task(next, false);
      for (const next of allInbox) item(next, false);
      initialized = true;
    },
  };
}
