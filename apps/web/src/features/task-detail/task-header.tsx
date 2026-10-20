import { isTerminalState, type TaskDetailDTO, taskMachine } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { useCancelTask } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

export function TaskHeader({ task }: { task: TaskDetailDTO }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelTask();
  const doing = task.progress ?? task.currentStep;
  return (
    <header className={styles.header}>
      <Link to={ROUTES.tasks} className="crumbs">
        {C.back}
      </Link>
      <div className={styles.titleRow}>
        <h1 className="title grow">{task.title}</h1>
        <TaskBadge group={task.displayGroup} />
        {!isTerminalState(taskMachine, task.status) && (
          <Button variant="ghost" icon="x" onClick={() => setConfirming(true)}>
            {C.cancel}
          </Button>
        )}
      </div>
      <span className="hint">{C.meta(task.key, task.project.name, task.workflow.name)}</span>
      {doing !== null && <span className={styles.doing}>{C.doing(doing)}</span>}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={C.cancelTitle}
        footer={
          <Button
            variant="danger"
            pending={cancel.isPending}
            onClick={() =>
              cancel.mutate(task.id, {
                onSuccess: () => {
                  setConfirming(false);
                  toast(C.cancelled);
                },
              })
            }
          >
            {C.cancelConfirm}
          </Button>
        }
      >
        <p>{C.cancelBody}</p>
        {cancel.isError && <ErrorState error={cancel.error} />}
      </Dialog>
    </header>
  );
}
