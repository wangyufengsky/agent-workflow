import { type BatchSummaryDTO, STATUS_TONE } from '@aw/shared';
import { StatusBadge } from '../../components/status-badge.tsx';
import { BATCHES_COPY as C } from '../../copy/batches.ts';
import { TASK_DISPLAY_LABEL } from '../../copy/tasks.ts';
import styles from './batches.module.css';

/** Progress of a batch (20 §4): how many tasks ended, and how many are in each display state. */
export function BatchProgress({ batch }: { batch: BatchSummaryDTO }) {
  const { ended, total } = batch;
  const label = ended === total ? C.allFinished : C.progress(ended, total);
  return (
    <div className="col" data-testid="batch-progress">
      <div
        className={styles.meter}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={ended}
      >
        <div className={styles.meterFill} style={{ width: `${(ended / total) * 100}%` }} />
      </div>
      <div className={styles.counts}>
        <span className="hint">{label}</span>
        {batch.counts.map(({ group, count }) => (
          <StatusBadge
            key={group}
            tone={STATUS_TONE.taskDisplay[group]}
            label={`${TASK_DISPLAY_LABEL[group]} ${count}`}
          />
        ))}
      </div>
    </div>
  );
}
