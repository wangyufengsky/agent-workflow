import type { TaskDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DELIVERY_COPY as C } from '../../copy/delivery.ts';
import { taskDiffFileQuery, taskDiffQuery } from '../tasks/tasks.queries.ts';

function TaskDiff({ taskId }: { taskId: string }) {
  const diff = useQuery(taskDiffQuery(taskId));
  if (diff.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (diff.isError) return <ErrorState error={diff.error} onRetry={() => void diff.refetch()} />;
  return <DiffBrowser files={diff.data.files} fileQuery={taskDiffFileQuery(taskId)} />;
}

/** Everything the task changed, file by file (14 §3.5「改动文件：点击看 diff」). */
export function ChangesDrawer({
  task,
  open,
  onOpenChange,
}: {
  task: TaskDetailDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={C.changesTitle} size="wide">
      {open && <TaskDiff taskId={task.id} />}
    </Drawer>
  );
}
