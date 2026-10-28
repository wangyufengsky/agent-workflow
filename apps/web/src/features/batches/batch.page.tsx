import {
  BatchDeliveryOutcome,
  type BatchDetailDTO,
  type DeliverBatchResponse,
  isBatchDeliverable,
  StatusTone,
  TaskStatus,
  WorkflowDeliverable,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { toast } from '../../components/toast.tsx';
import { BATCH_DELIVERY_NOTE, BATCHES_COPY as C } from '../../copy/batches.ts';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { BatchProgress } from './batch-progress.tsx';
import styles from './batches.module.css';
import { batchQuery, useDeliverBatch } from './batches.queries.ts';
import { TemplateText } from './template-text.tsx';

const route = getRouteApi(ROUTE_IDS.batch);

function outcomeMessage({ outcomes }: DeliverBatchResponse): {
  message: string;
  tone: typeof StatusTone.Ok | typeof StatusTone.Danger;
} {
  const count = (outcome: BatchDeliveryOutcome) => outcomes.filter((o) => o.outcome === outcome).length;
  const delivered = count(BatchDeliveryOutcome.Delivered);
  return {
    message: C.outcome(delivered, count(BatchDeliveryOutcome.Conflict), count(BatchDeliveryOutcome.Failed)),
    tone: delivered === outcomes.length ? StatusTone.Ok : StatusTone.Danger,
  };
}

/**
 *「合并全部待合并的」(20 §5): the dialog says how many tasks go where before one click delivers them one by one;
 * each merge is the user's (D16, D86).
 */
function DeliverAll({ batch }: { batch: BatchDetailDTO }) {
  const [open, setOpen] = useState(false);
  const deliver = useDeliverBatch();
  const ready = batch.items.filter(isBatchDeliverable).length;
  const report = batch.workflow.deliverable === WorkflowDeliverable.Report;
  const run = () =>
    deliver.mutate(
      { id: batch.id },
      {
        onSuccess: (result) => {
          setOpen(false);
          const { message, tone } = outcomeMessage(result);
          toast(message, tone);
        },
      },
    );
  return (
    <>
      <Button variant="primary" icon="check" disabled={ready === 0} onClick={() => setOpen(true)}>
        {report ? C.finishAll(ready) : C.deliverAll(ready)}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={report ? C.finishTitle(ready) : C.deliverTitle(ready)}
        description={report ? C.finishBody : C.deliverBody(batch.baseBranch)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{COMMON_COPY.cancel}</Button>
            <Button variant="primary" pending={deliver.isPending} onClick={run}>
              {report ? C.confirmFinish : C.confirmDeliver}
            </Button>
          </>
        }
      >
        {deliver.isError && <ErrorState error={deliver.error} />}
      </Dialog>
    </>
  );
}

/** A batch (20 §4): progress, every target's task with its state, and delivering the ones waiting for review. */
export function BatchPage() {
  const { batchId } = route.useParams();
  const batch = useQuery(batchQuery(batchId));
  if (batch.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (batch.isError) {
    return (
      <div className="page narrow">
        <ErrorState error={batch.error} onRetry={() => void batch.refetch()} />
      </div>
    );
  }
  const b = batch.data;
  return (
    <div className="page" data-testid="batch-page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">
            <span className="mono">{b.key}</span> · <TemplateText text={b.title} />
          </h1>
          <p className="lede">
            {C.meta(b.workflow.name, b.project.name)} · {formatDateTime(b.createdAt)}
          </p>
        </div>
        <DeliverAll batch={b} />
      </div>
      <section className="card pad col">
        <BatchProgress batch={b} />
      </section>
      <section className="section">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{C.columns.target}</th>
              <th>{C.columns.task}</th>
              <th>{C.columns.state}</th>
              <th>{C.columns.activity}</th>
            </tr>
          </thead>
          <tbody>
            {b.items.map((item) => {
              const note = item.lastDelivery === null ? undefined : BATCH_DELIVERY_NOTE[item.lastDelivery.status];
              return (
                <tr key={item.position} data-testid="batch-item">
                  <td className={styles.target}>{item.target}</td>
                  <td>
                    <Link to={ROUTES.task} params={{ taskId: item.task.id }}>
                      <span className="mono">{item.task.key}</span> · {item.task.title}
                    </Link>
                  </td>
                  <td>
                    <TaskBadge group={item.task.displayGroup} archived={item.task.archivedAt !== null} />
                    {item.task.status === TaskStatus.Review && note !== undefined && (
                      <span className={styles.note}>{note}</span>
                    )}
                  </td>
                  <td className="hint">
                    <Markdown inline source={item.task.progress ?? item.task.currentStep ?? ''} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <details className="section">
        <summary className="hint">{C.template}</summary>
        <div className={styles.preview}>
          <TemplateText text={b.requirementTemplate} />
        </div>
      </details>
    </div>
  );
}
