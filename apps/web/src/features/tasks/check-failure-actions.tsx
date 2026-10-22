import type { ErrorInfo } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { failedCommandOf, unrunnableDetails } from './failure-text.ts';
import { taskQuery, useSkipCheck, useUpdateCheckCommand } from './tasks.queries.ts';

/**
 * A failed task's ways out besides retrying when a check command stopped it (D116): change the command, or skip it
 * when the app's environment could not run it. The task page and the inbox card offer the same.
 */
export function CheckFailureActions({ taskId, error, size }: { taskId: string; error: ErrorInfo; size?: 'sm' }) {
  const [open, setOpen] = useState<'edit' | 'skip' | undefined>(undefined);
  const command = failedCommandOf(error);
  if (command === null) return null;
  const close = () => setOpen(undefined);
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
      {open === 'edit' && <EditCheckDialog taskId={taskId} command={command} onClose={close} />}
      {open === 'skip' && <SkipCheckDialog taskId={taskId} command={command} onClose={close} />}
    </>
  );
}

/** Opened only when asked for, so the task and its project are read then. */
function EditCheckDialog({ taskId, command, onClose }: { taskId: string; command: string; onClose: () => void }) {
  const task = useQuery(taskQuery(taskId)).data;
  const project = useQuery({ ...projectQuery(task?.project.id ?? ''), enabled: task !== undefined }).data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={C.editCheckTitle} description={C.editCheckBody}>
      {project === undefined ? null : (
        <EditCheckForm taskId={taskId} command={command} projectCommand={project.checkCommand} onClose={onClose} />
      )}
    </Dialog>
  );
}

/**
 * Prefilled with the project's check command when it differs from the failed one (the user already changed the
 * project), otherwise with the failed command; becoming the project's by default when the failed one was (D116).
 */
function EditCheckForm({
  taskId,
  command,
  projectCommand,
  onClose,
}: {
  taskId: string;
  command: string;
  projectCommand: string | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState(projectCommand ?? command);
  const [updateProject, setUpdateProject] = useState(projectCommand === command);
  const update = useUpdateCheckCommand();
  const save = () =>
    update.mutate(
      { id: taskId, command: value.trim(), updateProject },
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

function SkipCheckDialog({ taskId, command, onClose }: { taskId: string; command: string; onClose: () => void }) {
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
        <Markdown inline source={C.skipCheckBody(command)} />
      </p>
      {skip.isError && <ErrorState error={skip.error} />}
    </Dialog>
  );
}
