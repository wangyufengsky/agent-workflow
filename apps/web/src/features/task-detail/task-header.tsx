import { isTerminalState, NodeStatus, type TaskDetailDTO, TaskStatus, taskMachine } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { Elapsed } from '../../components/elapsed.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { toast } from '../../components/toast.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { useCancelTask, usePauseTask, useResumeTask, useStartTask } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

/** The task is working on its own: the header says how far it got and for how long (D118). */
const WORKING: readonly TaskStatus[] = [TaskStatus.Preparing, TaskStatus.Planning, TaskStatus.Running];
const FINISHED_STEP: readonly NodeStatus[] = [NodeStatus.Done, NodeStatus.Skipped];

type Props = {
  task: TaskDetailDTO;
  /** Pause and other pro actions are shown. */
  pro: boolean;
  /** Simple mode: whether「显示详细信息」is on; undefined in pro mode, where there is no toggle. */
  details: boolean | undefined;
  onDetailsChange: (on: boolean) => void;
};

export function TaskHeader({ task, pro, details, onDetailsChange }: Props) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelTask();
  const pause = usePauseTask();
  const resume = useResumeTask();
  const start = useStartTask();
  const doing = task.progress ?? task.currentStep;
  return (
    <header className={styles.header}>
      <Link to={ROUTES.tasks} className="crumbs">
        {C.back}
      </Link>
      <div className={styles.titleRow}>
        <h1 className="title grow">{task.title}</h1>
        <TaskBadge group={task.displayGroup} />
        {details !== undefined && (
          <Button variant="ghost" size="sm" icon="layers" onClick={() => onDetailsChange(!details)}>
            {details ? C.hideDetails : C.showDetails}
          </Button>
        )}
        {task.status === TaskStatus.Draft && (
          <Button variant="primary" icon="play" pending={start.isPending} onClick={() => start.mutate(task.id)}>
            {C.startDraft}
          </Button>
        )}
        {pro && task.status === TaskStatus.Running && (
          <Button icon="pause" pending={pause.isPending} onClick={() => pause.mutate(task.id)}>
            {C.pause}
          </Button>
        )}
        {task.status === TaskStatus.Paused && (
          <Button
            variant="primary"
            icon="play"
            pending={resume.isPending}
            onClick={() => resume.mutate(task.id, { onSuccess: () => toast(C.resumed) })}
          >
            {C.resume}
          </Button>
        )}
        {!isTerminalState(taskMachine, task.status) && (
          <Button variant="ghost" icon="x" onClick={() => setConfirming(true)}>
            {C.cancel}
          </Button>
        )}
      </div>
      <span className="hint">{C.meta(task.key, task.project.name, task.workflow.name)}</span>
      {WORKING.includes(task.status) && <Progress task={task} doing={doing} />}
      {task.status === TaskStatus.Draft && <span className="hint">{C.draft}</span>}
      {start.isError && <ErrorState error={start.error} />}
      {pause.isError && <ErrorState error={pause.error} />}
      {resume.isError && <ErrorState error={resume.error} />}
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

/** 「正在：X · 已完成 1 / 3 步 · 已用 12 分钟」: what, how far, how long (14 §3.3, D118). */
function Progress({ task, doing }: { task: TaskDetailDTO; doing: string | null }) {
  const done = task.nodes.filter((n) => FINISHED_STEP.includes(n.status)).length;
  return (
    <span className={styles.doing} data-testid="task-progress">
      {doing !== null && (
        <span>
          {C.doing}
          <Markdown inline source={doing} />
        </span>
      )}
      {task.nodes.length > 0 && <span>{C.stepsDone(done, task.nodes.length)}</span>}
      {task.startedAt !== null && (
        <span>
          <Elapsed since={task.startedAt} />
        </span>
      )}
    </span>
  );
}
