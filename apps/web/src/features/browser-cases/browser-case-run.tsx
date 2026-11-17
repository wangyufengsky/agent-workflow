import type { BrowserCase, TaskDetailDTO } from '@aw/shared';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { BROWSER_CASE_COPY as C } from '../../copy/browser-cases.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { BrowserCaseScope } from './browser-case-scope.tsx';

export function BrowserCaseRun({
  test,
  label,
  launch,
}: {
  test: BrowserCase;
  label: string;
  launch: () => Promise<TaskDetailDTO>;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const run = useMutation({
    mutationFn: launch,
    onSuccess: (task) => {
      setOpen(false);
      void navigate({ to: ROUTES.task, params: { taskId: task.id } });
    },
  });
  return (
    <>
      <Button
        size="sm"
        icon="play"
        onClick={() => {
          run.reset();
          setApproved(false);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={test.name}
        description={C.revision(test.revision)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {COMMON_COPY.cancel}
            </Button>
            <Button variant="primary" pending={run.isPending} disabled={!approved} onClick={() => run.mutate()}>
              {C.confirmRun}
            </Button>
          </>
        }
      >
        <BrowserCaseScope scope={test.scope} />
        <label className="row">
          <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
          {C.approve}
        </label>
        {run.isError && <ErrorState error={run.error} />}
      </Dialog>
    </>
  );
}
