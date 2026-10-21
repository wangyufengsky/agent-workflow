import type { TaskDetailDTO, TaskSummaryDTO } from '@aw/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../api/query-keys.ts';
import { updateTask } from './tasks.queries.ts';

const task = (status: 'preparing' | 'running') =>
  ({ id: 't1', status, displayGroup: status, workflow: { key: 'bugfix' } }) as unknown as TaskDetailDTO;

describe('task.updated 更新任务详情缓存', () => {
  it('首次读取还在进行时到达的事件不会被那次（更早的）读取结果覆盖', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let answerFirstRead: (t: TaskDetailDTO) => void = () => {};
    let reads = 0;
    const observer = new QueryObserver(qc, {
      queryKey: queryKeys.task('t1'),
      // The first read is answered late, with the state from before the event; later reads see the current state.
      queryFn: () =>
        ++reads === 1
          ? new Promise<TaskDetailDTO>((resolve) => {
              answerFirstRead = resolve;
            })
          : Promise.resolve(task('running')),
    });
    const unsubscribe = observer.subscribe(() => {});
    const updated = updateTask(qc, task('running') as unknown as TaskSummaryDTO);
    answerFirstRead(task('preparing'));
    await updated;
    expect(qc.getQueryData<TaskDetailDTO>(queryKeys.task('t1'))?.status).toBe('running');
    unsubscribe();
  });
});
