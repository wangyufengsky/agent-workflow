import { type ErrorInfo, TaskFailedPhase } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { FailureContext } from './failure-context.tsx';
import { failedCommandOf, pageUnrunnableDetails, unrunnableDetails } from './failure-text.ts';
import { taskQuery, useSkipCheck, useUpdateCheckCommand } from './tasks.queries.ts';

/**
 * A failed task's ways out besides retrying when a check command stopped it (D116): change the command, or skip it
 * when the app's environment could not run it. The task page and the inbox card offer the same.
 */
export function CheckFailureActions({ taskId, error, size }: { taskId: string; error: ErrorInfo; size?: 'sm' }) {
  const [open, setOpen] = useState<'edit' | 'skip' | undefined>(undefined);
  const command = failedCommandOf(error);
  const close = () => setOpen(undefined);
  // A page check whose preview could not run (29 §7.4): fix the preview's settings and retry, or skip it.
  if (pageUnrunnableDetails(error) !== undefined) {
    return (
      <>
        <EditPreviewLink taskId={taskId} size={size} />
        <Button size={size} onClick={() => setOpen('skip')}>
          {C.skipCheck}
        </Button>
        {open === 'skip' && <SkipCheckDialog taskId={taskId} body={C.skipPageCheckBody} onClose={close} />}
      </>
    );
  }
  if (command === null) return null;
  return (
    <>
      <Button size={size} onClick={() => setOpen('edit')}>
        {C.editCheck}
      </Button>
      {unrunnableDetails(error) !== undefined && (
        <Button size={size} onClick={() => setOpen('skip')}>
          {C.skipCheck}
        </Button>
      )}
      {open === 'edit' && <EditCheckDialog taskId={taskId} command={command} error={error} onClose={close} />}
      {open === 'skip' && <SkipCheckDialog taskId={taskId} body={C.skipCheckBody(command)} onClose={close} />}
    </>
  );
}

/** The project's preview settings; saving them and retrying checks the page again (29 §7.4). */
function EditPreviewLink({ taskId, size }: { taskId: string; size: 'sm' | undefined }) {
  const task = useQuery(taskQuery(taskId)).data;
  if (task === undefined) return null;
  return (
    <Link
      className={size === undefined ? 'btn secondary' : `btn secondary ${size}`}
      to={ROUTES.project}
      params={{ projectId: task.project.id }}
    >
      {C.editPreview}
    </Link>
  );
}

/** Show the failed condition before asking the user to change it. */
function EditCheckDialog({
  taskId,
  command,
  error,
  onClose,
}: {
  taskId: string;
  command: string;
  error: ErrorInfo;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={C.editCheckTitle} description={C.editCheckBody}>
      <FailureContext taskId={taskId} phase={TaskFailedPhase.Running} error={error} />
      <EditCheckForm taskId={taskId} command={command} onClose={onClose} />
    </Dialog>
  );
}

/**
 * The failed command is shown as the original condition; changing the project default is an explicit choice.
 */
function EditCheckForm({ taskId, command, onClose }: { taskId: string; command: string; onClose: () => void }) {
  const [value, setValue] = useState(command);
  const [updateProject, setUpdateProject] = useState(false);
  const update = useUpdateCheckCommand();
  const save = () =>
    update.mutate(
      { id: taskId, command: value.trim(), updateProject, expectedCommand: command },
      {
        onSuccess: () => {
          toast(C.rechecked);
          onClose();
        },
      },
    );
  return (
    <div className="col">
      <div className="field">
        <label className="label" htmlFor="check-command">
          {C.editCheckField}
        </label>
        <input id="check-command" className="input mono" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={updateProject} onChange={(e) => setUpdateProject(e.target.checked)} />
        <span>{C.editCheckProject}</span>
      </label>
      {update.isError && <ErrorState error={update.error} />}
      <div className="row">
        <Button variant="ghost" onClick={onClose}>
          {COMMON_COPY.cancel}
        </Button>
        <Button variant="primary" pending={update.isPending} disabled={value.trim() === ''} onClick={save}>
          {C.editCheckSave}
        </Button>
      </div>
    </div>
  );
}

function SkipCheckDialog({ taskId, body, onClose }: { taskId: string; body: string; onClose: () => void }) {
  const skip = useSkipCheck();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={C.skipCheckTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {COMMON_COPY.cancel}
          </Button>
          <Button
            variant="danger"
            pending={skip.isPending}
            onClick={() =>
              skip.mutate(taskId, {
                onSuccess: () => {
                  toast(C.checkSkipped);
                  onClose();
                },
              })
            }
          >
            {C.skipCheckConfirm}
          </Button>
        </>
      }
    >
      <p>
        <Markdown inline source={body} />
      </p>
      {skip.isError && <ErrorState error={skip.error} />}
    </Dialog>
  );
}
