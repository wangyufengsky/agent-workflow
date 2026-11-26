import { ErrorCode, exportGitReviewOp } from '@aw/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_REVIEW_COPY as C } from '../../copy/git-review.ts';

export function ReviewExportDialog({ reviewId, title, close }: { reviewId: string; title: string; close: () => void }) {
  const [targetDir, setTargetDir] = useState('');
  const mutation = useMutation({
    mutationFn: ({ overwrite }: { overwrite: boolean }) =>
      callOperation(exportGitReviewOp, { reviewId, targetDir: targetDir.trim(), overwrite }),
    onSuccess: ({ path }) => {
      toast(C.exportDone(path));
      close();
    },
  });
  const confirm = mutation.error instanceof ApiError && mutation.error.code === ErrorCode.DesignExportDirNotEmpty;
  const update = (value: string) => {
    mutation.reset();
    setTargetDir(value);
  };
  const choose = async () => {
    const dir = await window.aw?.selectDirectory(targetDir === '' ? undefined : targetDir);
    if (dir !== undefined && dir !== null) update(dir);
  };
  return (
    <Dialog
      open
      title={title}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      footer={
        <>
          <Button onClick={close} disabled={mutation.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button
            variant={confirm ? 'danger' : 'primary'}
            pending={mutation.isPending}
            disabled={targetDir.trim() === ''}
            onClick={() => mutation.mutate({ overwrite: confirm })}
          >
            {confirm ? C.exportConfirm : C.exportSubmit}
          </Button>
        </>
      }
    >
      <div className="row">
        <label className="col grow">
          {C.exportDir}
          <input
            className="input"
            value={targetDir}
            disabled={mutation.isPending}
            onChange={(event) => update(event.currentTarget.value)}
          />
        </label>
        {window.aw !== undefined && (
          <Button disabled={mutation.isPending} onClick={() => void choose()}>
            {C.exportChoose}
          </Button>
        )}
      </div>
      {confirm ? (
        <p className="banner warn" role="alert">
          {C.exportWillReplace}
        </p>
      ) : mutation.isError ? (
        <ErrorState error={mutation.error} />
      ) : null}
    </Dialog>
  );
}
