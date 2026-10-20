import type { TaskDetailDTO } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { useConfirmPlan } from '../tasks/tasks.queries.ts';

/** A paused task (09 §2): adjust the steps that have not started, apply a saved adjustment (M5-02). */
export function PausedBanner({ task, pro, onAdjust }: { task: TaskDetailDTO; pro: boolean; onAdjust: () => void }) {
  const confirm = useConfirmPlan();
  const draft = task.draftPlan;
  return (
    <div className="banner wait" data-testid="paused-banner">
      <Icon name="pause" />
      <div className="grow col">
        <span>{C.paused}</span>
        {draft !== null && (
          <span>
            {C.draftPending(draft.version)} · <span className="hint">{C.resumeDiscards}</span>
          </span>
        )}
        {confirm.isError && <ErrorState error={confirm.error} />}
      </div>
      {pro && (
        <div className="actions">
          {draft !== null && (
            <Button
              variant="primary"
              size="sm"
              icon="check"
              pending={confirm.isPending}
              onClick={() =>
                confirm.mutate({ id: task.id, version: draft.version }, { onSuccess: () => toast(C.adjusted) })
              }
            >
              {C.confirmAdjust}
            </Button>
          )}
          <Button size="sm" icon="edit" onClick={onAdjust}>
            {C.adjustPlan}
          </Button>
        </div>
      )}
    </div>
  );
}
