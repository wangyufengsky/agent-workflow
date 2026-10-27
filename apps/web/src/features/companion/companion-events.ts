import {
  COMPANION_PATH,
  type CompanionNotice,
  type InboxItemDTO,
  LIST_PAGE_MAX,
  listInboxOp,
  listTasksOp,
  type ServerEvent,
  ServerEventType,
  TaskStatus,
  type TaskSummaryDTO,
} from '@aw/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { callOperation } from '../../api/client.ts';
import { settingsQuery } from '../settings/settings.queries.ts';
import { createCompanionNotifications } from './companion-notifications.ts';

const ACTIVITY_KEY = ['companion', 'activity'] as const;
const WORKING: readonly TaskStatus[] = [
  TaskStatus.Preparing,
  TaskStatus.Planning,
  TaskStatus.Running,
  TaskStatus.Merging,
];
export const useCompanionUi = create<{ notices: CompanionNotice[]; error: unknown }>(() => ({
  notices: [],
  error: null,
}));
const removeNotice = (id: string) =>
  useCompanionUi.setState((s) => ({ notices: s.notices.filter((notice) => notice.id !== id) }));
/** 在一处处理即处处消失：本窗口、另一个窗口的气泡和系统通知（32 §3.5）。 */
export const dismissCompanionNotice = (id: string) => {
  removeNotice(id);
  window.aw?.companion.dismiss(id);
};
export const useCompanionWorking = () =>
  useQuery({ queryKey: ACTIVITY_KEY, enabled: false, queryFn: async (): Promise<TaskSummaryDTO[]> => [] }).data?.some(
    (t) => WORKING.includes(t.status),
  ) === true;

/** 每个窗口显示自己的提示；只有主窗口发系统通知。SSE 重连沿用同一个判重器。 */
export function connectCompanionEvents(qc: QueryClient) {
  let disposed = false;
  let loading: Promise<void> | undefined;
  const tracker = createCompanionNotifications(
    (notice) => {
      if (disposed) return;
      const settings = qc.getQueryData(settingsQuery.queryKey);
      const next = { ...notice, system: settings?.['companion.notifications'] === true };
      useCompanionUi.setState((s) => ({ notices: [...s.notices, next] }));
      if (window.location.pathname !== COMPANION_PATH) window.aw?.companion.notify(next);
    },
    (id) => {
      if (!disposed) dismissCompanionNotice(id);
    },
  );
  const offDismissed = window.aw?.companion.onDismissed(removeNotice);
  const snapshot = async () => {
    const tasks: TaskSummaryDTO[] = [];
    const inbox: InboxItemDTO[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: TaskSummaryDTO[]; nextCursor: string | null } = await callOperation(listTasksOp, {
        limit: LIST_PAGE_MAX,
        ...(cursor === null ? {} : { cursor }),
      });
      tasks.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null && !disposed);
    cursor = null;
    do {
      const page: { items: InboxItemDTO[]; nextCursor: string | null } = await callOperation(listInboxOp, {
        limit: LIST_PAGE_MAX,
        ...(cursor === null ? {} : { cursor }),
      });
      inbox.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null && !disposed);
    if (disposed) return;
    tracker.snapshot(tasks, inbox);
    qc.setQueryData<TaskSummaryDTO[]>(ACTIVITY_KEY, (current = []) => {
      const merged = new Map(tasks.map((task) => [task.id, task]));
      for (const task of current) {
        const before = merged.get(task.id);
        if (before !== undefined && before.updatedAt >= task.updatedAt) continue;
        merged.set(task.id, task);
      }
      return [...merged.values()];
    });
  };
  const resync = async () => {
    if (loading !== undefined) return loading;
    try {
      loading = snapshot();
      await loading;
      useCompanionUi.setState({ error: null });
    } catch (error) {
      if (!disposed) useCompanionUi.setState({ error });
    } finally {
      loading = undefined;
    }
  };
  return {
    resync,
    event(event: ServerEvent) {
      if (event.type === ServerEventType.TaskUpdated) {
        tracker.task(event.data);
        qc.setQueryData<TaskSummaryDTO[]>(ACTIVITY_KEY, (tasks = []) => [
          ...tasks.filter((t) => t.id !== event.data.id),
          event.data,
        ]);
      }
      if (event.type === ServerEventType.InboxUpdated) tracker.item(event.data.item);
    },
    close() {
      disposed = true;
      offDismissed?.();
    },
  };
}
