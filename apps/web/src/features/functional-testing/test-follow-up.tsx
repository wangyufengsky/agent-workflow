import { functionalTestRepairOp, functionalTestRerunOp, type TaskDetailDTO } from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { taskQuery } from '../tasks/tasks.queries.ts';

export function FunctionalTestSourceLinks({ task }: { task: TaskDetailDTO }) {
  return task.testLinks
    ?.filter(({ taskId }) => taskId === task.id)
    .map((link) => (
      <Link
        key={`${link.kind}:${link.sourceId}`}
        className="btn sm"
        to={ROUTES.task}
        params={{ taskId: link.sourceId }}
        search={{ view: 'result', testExecution: link.executionIds[0] }}
      >
        {C.sourceTask}
      </Link>
    ));
}

function LinkedTestTask({ id, label }: { id: string; label: string }) {
  const task = useQuery(taskQuery(id));
  return (
    <Link className="btn sm" to={ROUTES.task} params={{ taskId: id }}>
      {label}
      {task.data !== undefined && <TaskBadge group={task.data.displayGroup} />}
    </Link>
  );
}

export function TestFollowUp({ task, executionIds }: { task: TaskDetailDTO; executionIds: string[] }) {
  const queryClient = useQueryClient();
  const [ref, setRef] = useState('');
  const [open, setOpen] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: taskQuery(task.id).queryKey });
  };
  const repair = useMutation({
    mutationFn: () => callOperation(functionalTestRepairOp, { taskId: task.id, executionIds }),
    onSuccess: refresh,
  });
  const rerun = useMutation({
    mutationFn: () => callOperation(functionalTestRerunOp, { taskId: task.id, executionIds, ref: ref.trim() }),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
    },
  });
  const linked =
    task.testLinks?.filter(
      ({ sourceId, executionIds: ids }) =>
        sourceId === task.id && executionIds.length > 0 && executionIds.every((id) => ids.includes(id)),
    ) ?? [];
  const repairs = linked.filter(({ kind }) => kind === 'repair');
  const reruns = linked.filter(({ kind }) => kind === 'rerun');
  return (
    <div className="col">
      <div className="row wrap">
        {repairs.length === 0 && (
          <Button
            size="sm"
            disabled={executionIds.length === 0}
            pending={repair.isPending}
            onClick={() => repair.mutate()}
          >
            {C.repair}
          </Button>
        )}
        {repairs.map((link) => (
          <LinkedTestTask key={link.taskId} id={link.taskId} label={C.openRepair} />
        ))}
        {repairs.length > 0 && (
          <Button size="sm" onClick={() => setOpen(true)}>
            {C.rerun}
          </Button>
        )}
        {reruns.map((link) => (
          <LinkedTestTask key={link.taskId} id={link.taskId} label={C.openRerun} />
        ))}
      </div>
      {repair.isError && <ErrorState error={repair.error} />}
      <Dialog
        open={open}
        title={C.rerun}
        onOpenChange={setOpen}
        footer={
          <Button
            variant="primary"
            disabled={ref.trim() === ''}
            pending={rerun.isPending}
            onClick={() => rerun.mutate()}
          >
            {C.rerunConfirm}
          </Button>
        }
      >
        <label className="col">
          {C.rerunRef}
          <input className="input mono" value={ref} onChange={(event) => setRef(event.target.value)} />
        </label>
        {rerun.isError && <ErrorState error={rerun.error} />}
      </Dialog>
    </div>
  );
}
