import type { TaskDetailDTO } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { DELIVERY_COPY as C } from '../../copy/delivery.ts';
import { useRefreshDeliveryStatus } from '../tasks/tasks.queries.ts';

export function RemoteDeliveryStatus({ task }: { task: TaskDetailDTO }) {
  const refresh = useRefreshDeliveryStatus();
  const delivery = task.lastDelivery;
  if (delivery === null) return null;
  const status = delivery.remoteStatus;
  return (
    <section data-testid="remote-delivery-status">
      <Button size="sm" pending={refresh.isPending} onClick={() => refresh.mutate({ id: task.id })}>
        {C.remoteRefresh}
      </Button>
      {delivery.remoteError !== null && (
        <>
          {status !== null && <p>{C.remoteStale}</p>}
          <ErrorState error={delivery.remoteError} />
        </>
      )}
      {status !== null && (
        <div className="col">
          <span>{C.remoteState(status.state)}</span>
          <span>{C.remoteCi(status.ci)}</span>
          <span>{C.remoteReview(status.review)}</span>
          <span className="hint">{C.remoteChecked(status.checkedAt)}</span>
        </div>
      )}
    </section>
  );
}
